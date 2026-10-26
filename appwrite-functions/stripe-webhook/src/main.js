import { createHmac, timingSafeEqual } from 'node:crypto';
import { Client, ID, Messaging, TablesDB } from 'node-appwrite';
import {
    buildOrderEvent, buildPaymentNotification, buildPushRequest, checkSessionPayment, isFreshTimestamp, movePaymentStatus,
    parseStripeSignatureHeader, paymentIntentId, signedPayload, stripeEventToPayment, stripeRequest
} from './rules.js';

/**
 * Webhook de Stripe. Es el UNICO punto publico (Execute access: Any) y por eso:
 *  1. exige la cabecera Stripe-Signature y verifica HMAC-SHA256 sobre el cuerpo CRUDO,
 *  2. rechaza eventos viejos (tolerancia de 5 min),
 *  3. vuelve a comprobar importe, moneda y pedido contra la base de datos (no confia en el evento),
 *  4. es idempotente: un evento repetido no cambia nada ni vuelve a notificar.
 *
 * Eventos que atiende: checkout.session.completed / async_payment_succeeded / async_payment_failed /
 * expired y charge.refunded. Configura en Stripe SOLO esos eventos.
 */
const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;
const EVENTS = process.env.ORDER_EVENTS_TABLE_ID; // opcional
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY; // solo para reembolsar un pago tardio de un pedido cancelado
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET; // whsec_..., nunca en la app

const reply = (res, status, body) => res.json(body, status);

/** Comparacion en tiempo constante de dos firmas hexadecimales. */
function safeEqualHex(a, b) {
    const x = Buffer.from(a, 'utf8');
    const y = Buffer.from(b, 'utf8');
    return x.length === y.length && timingSafeEqual(x, y);
}

export default async ({ req, res, log, error }) => {
    if (req.method !== 'POST') return reply(res, 405, { code: 'method_not_allowed' });
    if (!WEBHOOK_SECRET) return reply(res, 503, { code: 'not_configured' });

    const raw = typeof req.bodyText === 'string' ? req.bodyText : '';
    const parsed = parseStripeSignatureHeader(req.headers['stripe-signature']);
    if (!raw || !parsed) return reply(res, 400, { code: 'bad_signature' });
    if (!isFreshTimestamp(parsed.timestamp)) return reply(res, 400, { code: 'stale_event' });

    const expected = createHmac('sha256', WEBHOOK_SECRET).update(signedPayload(parsed.timestamp, raw)).digest('hex');
    if (!parsed.signatures.some((sig) => safeEqualHex(sig, expected))) return reply(res, 400, { code: 'bad_signature' });

    let event;
    try {
        event = JSON.parse(raw);
    } catch {
        return reply(res, 400, { code: 'bad_json' });
    }

    const change = stripeEventToPayment(event);
    if (!change || typeof change.orderId !== 'string') return reply(res, 200, { received: true, ignored: true });

    const client = new Client()
        .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
        .setKey(req.headers['x-appwrite-key']);
    const db = new TablesDB(client);
    const messaging = new Messaging(client);

    const record = async (order, type, from, to) => {
        if (!EVENTS) return;
        try {
            await db.createRow({ databaseId: DB, tableId: EVENTS, rowId: ID.unique(), data: buildOrderEvent({ orderId: order.$id, type, from, to, actorId: 'stripe', actorRole: 'system' }) });
        } catch (e) {
            error(`event_failed: ${e.message}`);
        }
    };
    const notify = async (accountId, message) => {
        const push = buildPushRequest(accountId, message);
        if (!push) return;
        try {
            await messaging.createPush({ messageId: ID.unique(), ...push });
        } catch (e) {
            error(`push_failed: ${e.message}`);
        }
    };

    try {
        let order;
        try {
            order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: change.orderId });
        } catch {
            // Pedido inexistente: no tiene caso que Stripe reintente.
            log(`unknown order ${change.orderId}`);
            return reply(res, 200, { received: true, ignored: true });
        }
        if (order.paymentMethod !== 'online') return reply(res, 200, { received: true, ignored: true });
        const current = order.paymentStatus || 'pending';

        if (change.kind === 'paid') {
            // El importe, la moneda y el pedido se validan contra lo guardado en el servidor.
            const verdict = checkSessionPayment(change.session, { orderId: order.$id, total: order.total });
            if (verdict.state !== 'paid') {
                error(`payment_rejected order=${order.$id} reason=${verdict.reason}`);
                return reply(res, 200, { received: true, ignored: true });
            }
            // Pago llegado tarde sobre un pedido ya cancelado: se devuelve el dinero (una sola vez).
            if (order.status === 'cancelled') {
                const pi = paymentIntentId(change.session);
                if (!STRIPE_KEY || !pi) return reply(res, 500, { code: 'refund_unavailable' }); // Stripe reintentara
                const refund = await stripeRequest({ secret: STRIPE_KEY, path: '/v1/refunds', params: [['payment_intent', pi], ['metadata[orderId]', order.$id]], idempotencyKey: `refund-${order.$id}` });
                if (!refund.ok) return reply(res, 500, { code: 'refund_failed' });
                const move = movePaymentStatus(current, 'refunded');
                if (move.ok && move.changed) {
                    await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data: { paymentStatus: 'refunded', paymentId: pi.slice(0, 64) } });
                    await record(order, 'payment_refunded', order.status, order.status);
                    await notify(order.userId, buildPaymentNotification('refunded', order.$id));
                }
                return reply(res, 200, { received: true });
            }
            const move = movePaymentStatus(current, 'paid');
            if (move.ok && move.changed) {
                const data = { paymentStatus: 'paid' };
                const pi = paymentIntentId(change.session);
                if (pi) data.paymentId = pi.slice(0, 64);
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data });
                await record(order, 'payment_paid', order.status, order.status);
                await notify(order.userId, buildPaymentNotification('paid', order.$id));
            }
            return reply(res, 200, { received: true });
        }

        if (change.kind === 'failed') {
            const move = movePaymentStatus(current, 'failed');
            if (move.ok && move.changed) {
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data: { paymentStatus: 'failed' } });
                await record(order, 'payment_failed', order.status, order.status);
                await notify(order.userId, buildPaymentNotification('failed', order.$id));
            }
            return reply(res, 200, { received: true });
        }

        if (change.kind === 'refunded') {
            const move = movePaymentStatus(current, 'refunded');
            if (move.ok && move.changed) {
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data: { paymentStatus: 'refunded' } });
                await record(order, 'payment_refunded', order.status, order.status);
                await notify(order.userId, buildPaymentNotification('refunded', order.$id));
            }
            return reply(res, 200, { received: true });
        }

        // expired: el pedido sigue pendiente y puede reintentarse con "Pagar ahora"; solo se deja constancia.
        await record(order, 'payment_expired', order.status, order.status);
        return reply(res, 200, { received: true });
    } catch (e) {
        error(e.message);
        // 500 => Stripe reintenta con el mismo evento; los pasos anteriores son idempotentes.
        return reply(res, 500, { code: 'internal' });
    }
};
