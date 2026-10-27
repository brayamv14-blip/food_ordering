import { Client, ID, Messaging, Query, TablesDB, Users } from 'node-appwrite';
import {
    ACTIVE_DELIVERY, buildAssignmentNotification, buildCheckoutSessionParams, buildOrderEvent, buildPaymentNotification,
    buildPushRequest, buildStatusNotification, canActorTransition, canAssignDriver, checkExpected, checkSessionPayment,
    isStripeCheckoutUrl, matchesOrderQuery, movePaymentStatus, parseDateRange, paymentIntentId, stripeRequest,
    toStaffOrderView, validateDriverPosition
} from './rules.js';

/**
 * Funcion unica de operaciones sobre pedidos ya creados (la creacion vive en
 * `create-order`). Contrato por el campo `action` del cuerpo JSON:
 *
 *   updateStatus   (por omision)  cliente: cancelar propio pendiente | staff | driver asignado
 *   syncPayment                   dueno o staff: verifica el pago en linea con Stripe (en el servidor)
 *   payOrder                      dueno: devuelve el enlace de Stripe Checkout para pagar (o reintentar) su pedido
 *   updateLocation                driver asignado, pedido en camino
 *   myDeliveries                  driver: sus entregas activas
 *   listOrders / listDrivers / assignDriver / orderHistory    solo staff
 *
 * Toda autorizacion se decide aqui con las etiquetas de la cuenta; la interfaz
 * solo oculta botones.
 */
const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;
const ITEMS = process.env.ORDER_ITEMS_TABLE_ID;
const EVENTS = process.env.ORDER_EVENTS_TABLE_ID; // opcional
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY; // solo en la Function; necesario para pagos y reembolsos
const PAYMENT_RETURN_URL = process.env.PAYMENT_RETURN_URL; // https de recovery-bridge/payment-return.html
const STATUSES = ['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled'];

const fail = (res, status, code, error) => res.json({ code, error }, status);

export default async ({ req, res, log, error }) => {
    const userId = req.headers['x-appwrite-user-id'];
    if (!userId) return fail(res, 401, 'unauthenticated', 'Inicia sesión.');

    const client = new Client()
        .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
        .setKey(req.headers['x-appwrite-key']);
    const db = new TablesDB(client);
    const users = new Users(client);
    const messaging = new Messaging(client);

    let body;
    try {
        body = typeof req.bodyJson === 'object' && req.bodyJson ? req.bodyJson : JSON.parse(req.bodyText || '{}');
    } catch {
        return fail(res, 400, 'bad_json', 'Cuerpo inválido.');
    }
    const action = typeof body.action === 'string' ? body.action : 'updateStatus';

    // El historial es informativo: si falla, nunca bloquea la operacion principal.
    const record = async (event) => {
        if (!EVENTS) return;
        try {
            await db.createRow({ databaseId: DB, tableId: EVENTS, rowId: ID.unique(), data: buildOrderEvent(event) });
        } catch (e) {
            error(`event_failed: ${e.message}`);
        }
    };

    // Notificaciones push (Appwrite Messaging + FCM). Mejor esfuerzo: nunca bloquea ni hace fallar la operacion.
    // El destinatario lo decide siempre el servidor (dueno del pedido o repartidor asignado).
    const notify = async (accountId, message) => {
        const req = buildPushRequest(accountId, message);
        if (!req) return;
        try {
            await messaging.createPush({ messageId: ID.unique(), ...req });
        } catch (e) {
            error(`push_failed: ${e.message}`);
        }
    };

    const stripe = (opts) => stripeRequest({ secret: STRIPE_KEY, ...opts });

    /** Consulta la sesion de Stripe del pedido (con su PaymentIntent). */
    const getSession = async (order) => {
        if (!order.stripeSessionId) return null;
        const r = await stripe({ method: 'GET', path: `/v1/checkout/sessions/${encodeURIComponent(order.stripeSessionId)}` });
        return r.ok ? r.data : null;
    };

    /** Marca el pago como pagado (idempotente). Devuelve true solo si hubo cambio real. */
    const markPaid = async (order, session, actor) => {
        const move = movePaymentStatus(order.paymentStatus || 'pending', 'paid');
        if (!move.ok || !move.changed) return false;
        const data = { paymentStatus: 'paid' };
        const pi = paymentIntentId(session);
        if (pi) data.paymentId = pi.slice(0, 64);
        await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data });
        await record({ orderId: order.$id, type: 'payment_paid', from: order.status, to: order.status, actorId: actor.id, actorRole: actor.role });
        await notify(order.userId, buildPaymentNotification('paid', order.$id));
        return true;
    };

    const itemsFor = async (orders) => {
        if (orders.length === 0 || !ITEMS) return {};
        const rows = (await db.listRows({
            databaseId: DB, tableId: ITEMS,
            queries: [Query.equal('orderId', orders.map((o) => o.$id)), Query.limit(500)]
        })).rows;
        const by = {};
        for (const r of rows) (by[r.orderId] ??= []).push(r);
        return by;
    };

    try {
        const me = await users.get({ userId });
        const labels = me.labels ?? [];
        const isStaff = labels.includes('staff');
        const isDriver = labels.includes('driver');
        const actor = isStaff ? 'staff' : isDriver ? 'driver' : 'customer';
        const needStaff = () => (isStaff ? null : fail(res, 403, 'forbidden', 'Solo personal autorizado.'));

        switch (action) {
            case 'updateStatus': {
                const { orderId, status: to } = body;
                if (typeof orderId !== 'string' || typeof to !== 'string') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                const isOwner = order.userId === userId;

                // Un repartidor solo opera pedidos que tiene asignados.
                if (actor === 'driver' && order.driverUserId !== userId) return fail(res, 403, 'forbidden', 'Este pedido no está asignado a ti.');
                // Un cliente solo toca sus propios pedidos (y no revela que otros existen).
                if (actor === 'customer' && !isOwner) return fail(res, 404, 'not_found', 'Pedido no encontrado.');

                const stale = checkExpected(order, body);
                if (!stale.ok) return fail(res, 409, stale.code, stale.error);

                const verdict = canActorTransition({
                    actor, isOwner, from: order.status, to, hasDriver: !!order.driverUserId,
                    payment: { method: order.paymentMethod || 'cash_on_delivery', status: order.paymentStatus || null }
                });
                if (!verdict.ok) return fail(res, verdict.code === 'forbidden' ? 403 : 409, verdict.code, verdict.error);

                const data = { status: to };
                const online = order.paymentMethod === 'online';
                let refunded = false;
                if (to === 'cancelled' && online) {
                    if (order.paymentStatus === 'paid') {
                        // Pedido pagado: PRIMERO se reembolsa (una sola vez, clave idempotente) y despues se cancela.
                        if (!STRIPE_KEY) return fail(res, 503, 'payment_unavailable', 'El reembolso no está configurado.');
                        const session = await getSession(order);
                        const pi = paymentIntentId(session);
                        if (!pi) return fail(res, 502, 'refund_failed', 'No se pudo localizar el cobro para reembolsarlo.');
                        const refund = await stripe({ path: '/v1/refunds', params: [['payment_intent', pi], ['metadata[orderId]', orderId]], idempotencyKey: `refund-${orderId}` });
                        if (!refund.ok || !refund.data || !['succeeded', 'pending'].includes(refund.data.status)) {
                            return fail(res, 502, 'refund_failed', 'No se pudo emitir el reembolso. El pedido no se canceló; inténtalo de nuevo.');
                        }
                        data.paymentStatus = 'refunded';
                        refunded = true;
                    } else if (['pending', 'failed'].includes(order.paymentStatus || 'pending')) {
                        // Sin cobro: se cierra la sesion de Stripe para que nadie pague un pedido cancelado.
                        if (STRIPE_KEY && order.stripeSessionId) {
                            await stripe({ path: `/v1/checkout/sessions/${encodeURIComponent(order.stripeSessionId)}/expire`, idempotencyKey: `expire-${orderId}` });
                        }
                        data.paymentStatus = 'cancelled';
                    }
                }
                // Al terminar el pedido no se conserva la ubicacion del repartidor.
                if (to === 'delivered' || to === 'cancelled') {
                    data.driverLatitude = null;
                    data.driverLongitude = null;
                }
                const updated = await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data });
                await record({ orderId, type: 'status', from: order.status, to, actorId: userId, actorRole: actor, driverUserId: order.driverUserId ?? null });
                // Al cliente se le avisa de los cambios hechos por el restaurante o el repartidor (no de los suyos).
                if (refunded) await record({ orderId, type: 'payment_refunded', from: order.status, to, actorId: userId, actorRole: actor });
                if (actor !== 'customer') await notify(order.userId, buildStatusNotification(to, orderId));
                if (refunded) await notify(order.userId, buildPaymentNotification('refunded', orderId));
                return res.json({ orderId: updated.$id, status: updated.status, updatedAt: updated.$updatedAt ?? null });
            }

            case 'syncPayment': {
                const { orderId } = body;
                if (typeof orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                // Un cliente solo verifica sus propios pedidos.
                if (actor === 'customer' && order.userId !== userId) return fail(res, 404, 'not_found', 'Pedido no encontrado.');
                if (actor === 'driver') return fail(res, 403, 'forbidden', 'No tienes permiso para esta acción.');
                if (order.paymentMethod !== 'online') return fail(res, 409, 'not_online', 'Este pedido no tiene pago en línea.');
                if (['paid', 'refunded'].includes(order.paymentStatus)) return res.json({ paymentStatus: order.paymentStatus, providerStatus: order.paymentStatus === 'paid' ? 'paid' : 'refunded', orderId });
                if (!STRIPE_KEY) return fail(res, 503, 'payment_unavailable', 'La verificación de pagos no está configurada.');
                if (!order.stripeSessionId) return res.json({ paymentStatus: order.paymentStatus || 'pending', providerStatus: null, orderId });

                const session = await getSession(order);
                if (!session) return fail(res, 502, 'payment_unavailable', 'No se pudo consultar el pago. Inténtalo de nuevo.');
                // Solo cuenta un pago confirmado por Stripe con el importe EXACTO calculado en el servidor.
                const verdict = checkSessionPayment(session, { orderId, total: order.total });
                if (verdict.state === 'paid') {
                    await markPaid(order, session, { id: userId, role: actor });
                    return res.json({ paymentStatus: 'paid', providerStatus: 'paid', orderId });
                }
                if (verdict.state === 'invalid') error(`payment_invalid order=${orderId} reason=${verdict.reason}`);
                return res.json({ paymentStatus: order.paymentStatus || 'pending', providerStatus: verdict.state, orderId });
            }

            case 'payOrder': {
                const { orderId } = body;
                if (typeof orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (order.userId !== userId) return fail(res, 404, 'not_found', 'Pedido no encontrado.');
                if (order.paymentMethod !== 'online') return fail(res, 409, 'not_online', 'Este pedido no tiene pago en línea.');
                if (order.paymentStatus === 'paid') return res.json({ paymentStatus: 'paid', orderId });
                if (order.status === 'cancelled' || !['pending', 'failed'].includes(order.paymentStatus || 'pending')) {
                    return fail(res, 409, 'not_payable', 'Este pedido ya no se puede pagar.');
                }
                if (!STRIPE_KEY || !PAYMENT_RETURN_URL) return fail(res, 503, 'payment_unavailable', 'El pago en línea no está disponible por el momento.');

                const existing = await getSession(order);
                // Si ya habia sesion pero Stripe no respondio, no se crea otra a ciegas: se reintenta despues.
                if (order.stripeSessionId && !existing) return fail(res, 502, 'payment_unavailable', 'No se pudo consultar el pago. Inténtalo de nuevo.');
                if (existing) {
                    const verdict = checkSessionPayment(existing, { orderId, total: order.total });
                    if (verdict.state === 'paid') {
                        await markPaid(order, existing, { id: userId, role: actor });
                        return res.json({ paymentStatus: 'paid', orderId });
                    }
                    // Sesion todavia abierta: se reutiliza (no se crea otro cobro).
                    if (existing.status === 'open' && isStripeCheckoutUrl(existing.url)) return res.json({ checkoutUrl: existing.url, orderId });
                }
                // Sin sesion o ya vencida: se crea una nueva, ligada a la anterior para que repetir la llamada no duplique.
                const key = existing ? `checkout-${orderId}-after-${order.stripeSessionId}` : `checkout-${orderId}-1`;
                const created = await stripe({
                    path: '/v1/checkout/sessions',
                    params: buildCheckoutSessionParams({ orderId, userId: order.userId, total: order.total, returnUrl: PAYMENT_RETURN_URL }),
                    idempotencyKey: key.slice(0, 255)
                });
                const s = created.data;
                if (!created.ok || !s || typeof s.id !== 'string' || !isStripeCheckoutUrl(s.url)) {
                    return fail(res, 502, 'payment_unavailable', 'No se pudo iniciar el pago en línea. Inténtalo de nuevo.');
                }
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data: { stripeSessionId: s.id } });
                return res.json({ checkoutUrl: s.url, orderId });
            }

            case 'updateLocation': {
                if (!isDriver) return fail(res, 403, 'forbidden', 'Solo repartidores.');
                const { orderId, latitude, longitude } = body;
                if (typeof orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (order.driverUserId !== userId) return fail(res, 403, 'forbidden', 'Pedido no asignado a ti.');
                if (order.status !== 'on_the_way') return fail(res, 409, 'not_on_the_way', 'El pedido no está en camino.');
                const last = order.driverUpdatedAt ? Date.parse(order.driverUpdatedAt) : null;
                const check = validateDriverPosition({ latitude, longitude, lastUpdateMs: Number.isNaN(last) ? null : last });
                if (!check.ok) return fail(res, check.code === 'rate_limited' ? 429 : 400, check.code, check.error);
                await db.updateRow({
                    databaseId: DB, tableId: ORDERS, rowId: orderId,
                    data: { driverLatitude: check.latitude, driverLongitude: check.longitude, driverUpdatedAt: new Date().toISOString() }
                });
                return res.json({ ok: true });
            }

            case 'myDeliveries': {
                if (!isDriver) return fail(res, 403, 'forbidden', 'Solo repartidores.');
                const orders = (await db.listRows({
                    databaseId: DB, tableId: ORDERS,
                    // `history: true` => entregas ya terminadas (entregado/cancelado) de ESTE repartidor.
                    queries: [Query.equal('driverUserId', userId), Query.equal('status', body.history === true ? ['delivered', 'cancelled'] : ACTIVE_DELIVERY), Query.orderDesc('$createdAt'), Query.limit(20)]
                })).rows;
                const items = await itemsFor(orders);
                return res.json({ orders: orders.map((o) => toStaffOrderView(o, items[o.$id] ?? [])) });
            }

            case 'listOrders': {
                const denied = needStaff();
                if (denied) return denied;
                const queries = [Query.orderDesc('$createdAt')];
                if (body.status !== undefined) {
                    if (!STATUSES.includes(body.status)) return fail(res, 400, 'bad_status', 'Estado inválido.');
                    queries.unshift(Query.equal('status', body.status));
                }
                const range = parseDateRange(body);
                if (!range.ok) return fail(res, 400, range.code, range.error);
                if (range.from) queries.unshift(Query.greaterThanEqual('$createdAt', range.from));
                if (range.to) queries.unshift(Query.lessThanEqual('$createdAt', range.to));
                const searching = typeof body.query === 'string' && body.query.trim() !== '';
                // Con busqueda se revisan hasta 100 recientes (el sufijo del id no es consultable).
                queries.push(Query.limit(searching ? 100 : 50));
                let orders = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries })).rows;
                if (searching) orders = orders.filter((o) => matchesOrderQuery(o.$id, body.query)).slice(0, 50);
                const items = await itemsFor(orders);
                return res.json({ orders: orders.map((o) => toStaffOrderView(o, items[o.$id] ?? [])) });
            }

            case 'listDrivers': {
                const denied = needStaff();
                if (denied) return denied;
                const list = await users.list({ queries: [Query.equal('labels', ['driver']), Query.limit(50)] });
                return res.json({ drivers: list.users.map((u) => ({ id: u.$id, name: u.name || 'Repartidor' })) });
            }

            case 'assignDriver': {
                const denied = needStaff();
                if (denied) return denied;
                const { orderId, driverUserId } = body;
                if (typeof orderId !== 'string' || typeof driverUserId !== 'string') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const driver = await users.get({ userId: driverUserId }).catch(() => null);
                if (!driver || !(driver.labels ?? []).includes('driver')) return fail(res, 422, 'not_a_driver', 'Esa cuenta no es repartidor.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                const stale = checkExpected(order, body);
                if (!stale.ok) return fail(res, 409, stale.code, stale.error);
                if (!canAssignDriver(order.status)) return fail(res, 409, 'not_assignable', 'El pedido ya terminó.');
                const changed = order.driverUserId !== driverUserId;
                const updated = await db.updateRow({
                    databaseId: DB, tableId: ORDERS, rowId: orderId,
                    // Si cambia el repartidor, se descarta la ubicacion del anterior.
                    data: { driverUserId, driverName: String(driver.name || 'Repartidor').slice(0, 80), ...(changed ? { driverLatitude: null, driverLongitude: null } : {}) }
                });
                if (changed) {
                    await record({ orderId, type: 'driver_assigned', from: order.status, to: order.status, actorId: userId, actorRole: 'staff', driverUserId });
                    await notify(driverUserId, buildAssignmentNotification(orderId));
                }
                return res.json({ orderId: updated.$id, driverName: updated.driverName, updatedAt: updated.$updatedAt ?? null });
            }

            case 'orderHistory': {
                const denied = needStaff();
                if (denied) return denied;
                if (typeof body.orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                if (!EVENTS) return res.json({ events: [], enabled: false });
                const rows = (await db.listRows({
                    databaseId: DB, tableId: EVENTS,
                    queries: [Query.equal('orderId', body.orderId), Query.orderAsc('$createdAt'), Query.limit(100)]
                })).rows;
                return res.json({
                    enabled: true,
                    events: rows.map((e) => ({ type: e.type, from: e.fromStatus ?? null, to: e.toStatus ?? null, actorRole: e.actorRole ?? null, at: e.$createdAt }))
                });
            }

            default:
                return fail(res, 400, 'bad_action', 'Acción no válida.');
        }
    } catch (e) {
        error(e.message);
        return fail(res, 500, 'internal', 'No se pudo completar la operación.');
    }
};
