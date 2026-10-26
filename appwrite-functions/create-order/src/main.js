import { Client, ID, Permission, Query, Role, TablesDB, Users } from 'node-appwrite';
import { buildOrderEvent, buildPreferenceBody, priceOrder, validateAddressInput, validatePaymentMethod, validatePhone } from './rules.js';

const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;
const ITEMS = process.env.ORDER_ITEMS_TABLE_ID;
const MENU = process.env.MENU_TABLE_ID;
const CUSTOMIZATIONS = process.env.CUSTOMIZATIONS_TABLE_ID;
// Relacion producto <-> extras (tabla menu_customizations: columnas `menu` y `customizations`).
const MENU_CUSTOMIZATIONS = process.env.MENU_CUSTOMIZATIONS_TABLE_ID;
const EVENTS = process.env.ORDER_EVENTS_TABLE_ID; // opcional: historial de cambios
const DELIVERY_FEE = Number(process.env.DELIVERY_FEE ?? 5);
const DISCOUNT = Number(process.env.DISCOUNT ?? 0.5);
// Pago en linea (Mercado Pago Checkout Pro). Sin estas variables el pago en linea se rechaza.
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const PAYMENT_RETURN_URL = process.env.PAYMENT_RETURN_URL;

/** Crea la preferencia de pago. Devuelve la URL de pago o null si falla. */
async function createPaymentPreference(orderId, total) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
        const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
            method: 'POST',
            headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPreferenceBody({ orderId, total, returnUrl: PAYMENT_RETURN_URL })),
            signal: ctrl.signal
        });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data?.init_point === 'string' && data.init_point.startsWith('https://') ? data.init_point : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

const fail = (res, status, code, error) => res.json({ code, error }, status);
const relId = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.$id : undefined);

export default async ({ req, res, log, error }) => {
    const userId = req.headers['x-appwrite-user-id'];
    if (!userId) return fail(res, 401, 'unauthenticated', 'Inicia sesión para hacer un pedido.');

    const client = new Client()
        .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
        .setKey(req.headers['x-appwrite-key']);
    const db = new TablesDB(client);
    const users = new Users(client);

    let body;
    try {
        body = typeof req.bodyJson === 'object' && req.bodyJson ? req.bodyJson : JSON.parse(req.bodyText || '{}');
    } catch {
        return fail(res, 400, 'bad_json', 'Cuerpo inválido.');
    }

    const { clientRequestId, address, contact, items } = body;
    if (typeof clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId)) {
        return fail(res, 400, 'bad_request_id', 'Falta el identificador del intento.');
    }
    const addr = validateAddressInput(address);
    if (!addr.ok) return fail(res, 400, addr.code, addr.error);
    const phone = validatePhone(contact && contact.phone);
    if (!phone.ok) return fail(res, 400, phone.code, phone.error);
    const pay = validatePaymentMethod(body.paymentMethod);
    if (!pay.ok) return fail(res, 400, pay.code, pay.error);
    const online = pay.method === 'online';
    if (online && (!MP_TOKEN || !PAYMENT_RETURN_URL)) {
        return fail(res, 503, 'payment_unavailable', 'El pago en línea no está disponible por el momento.');
    }

    const permissions = [Permission.read(Role.user(userId))];

    try {
        // Idempotencia: el mismo intento devuelve el mismo pedido.
        const existing = await db.listRows({
            databaseId: DB, tableId: ORDERS,
            queries: [Query.equal('clientRequestId', clientRequestId), Query.limit(1)]
        });
        if (existing.rows[0]) {
            if (existing.rows[0].userId !== userId) return fail(res, 409, 'conflict', 'Identificador en uso.');
            const prev = existing.rows[0];
            return res.json({
                orderId: prev.$id, duplicate: true,
                ...(prev.paymentMethod === 'online' && prev.paymentStatus === 'pending' && prev.paymentUrl ? { checkoutUrl: prev.paymentUrl } : {})
            });
        }

        if (!Array.isArray(items)) return fail(res, 422, 'empty_cart', 'El pedido no tiene productos.');
        const menuIds = [...new Set(items.map((i) => i && i.menuId).filter((x) => typeof x === 'string'))];
        const extraIds = [...new Set(items.flatMap((i) => (i && Array.isArray(i.customizationIds) ? i.customizationIds : [])).filter((x) => typeof x === 'string'))];

        const menuRows = menuIds.length
            ? (await db.listRows({ databaseId: DB, tableId: MENU, queries: [Query.equal('$id', menuIds), Query.limit(100)] })).rows
            : [];
        const extraRows = extraIds.length
            ? (await db.listRows({ databaseId: DB, tableId: CUSTOMIZATIONS, queries: [Query.equal('$id', extraIds), Query.limit(100)] })).rows
            : [];

        let allowedExtrasByMenu = null;
        if (extraIds.length && MENU_CUSTOMIZATIONS) {
            const relations = (await db.listRows({
                databaseId: DB, tableId: MENU_CUSTOMIZATIONS,
                queries: [Query.equal('menu', menuIds), Query.limit(500)]
            })).rows;
            allowedExtrasByMenu = {};
            for (const r of relations) {
                const m = relId(r.menu);
                const c = relId(r.customizations);
                if (m && c) (allowedExtrasByMenu[m] ??= new Set()).add(c);
            }
        }

        const priced = priceOrder({
            items,
            menuById: Object.fromEntries(menuRows.map((r) => [r.$id, r])),
            extrasById: Object.fromEntries(extraRows.map((r) => [r.$id, r])),
            allowedExtrasByMenu,
            deliveryFee: DELIVERY_FEE,
            discount: DISCOUNT
        });
        if (!priced.ok) return fail(res, 422, priced.code, priced.error);

        // El nombre sale de la cuenta, no del cliente.
        const account = await users.get({ userId });

        const order = await db.createRow({
            databaseId: DB, tableId: ORDERS, rowId: ID.unique(), permissions,
            data: {
                userId,
                status: 'pending',
                subtotal: priced.subtotal,
                total: priced.total,
                deliveryFee: priced.deliveryFee,
                discount: priced.discount,
                paymentMethod: pay.method,
                paymentStatus: online ? 'pending' : 'not_required',
                clientRequestId,
                customerName: String(account.name ?? '').slice(0, 80),
                customerPhone: phone.phone.slice(0, 20),
                deliveryAddress: addr.line,
                deliveryAddressLabel: addr.label,
                deliveryLatitude: addr.latitude,
                deliveryLongitude: addr.longitude
            }
        });

        const created = [];
        try {
            for (const l of priced.lines) {
                const row = await db.createRow({
                    databaseId: DB, tableId: ITEMS, rowId: ID.unique(), permissions,
                    data: { orderId: order.$id, ...l }
                });
                created.push(row.$id);
            }
        } catch (e) {
            error(`items_failed: ${e.message}`);
            for (const id of created) await db.deleteRow({ databaseId: DB, tableId: ITEMS, rowId: id }).catch(() => {});
            await db.deleteRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id }).catch(() => {});
            return fail(res, 500, 'items_failed', 'No se pudieron guardar los productos.');
        }

        if (EVENTS) {
            await db.createRow({
                databaseId: DB, tableId: EVENTS, rowId: ID.unique(),
                data: buildOrderEvent({ orderId: order.$id, type: 'created', to: 'pending', actorId: userId, actorRole: 'customer' })
            }).catch((e) => error(`event_failed: ${e.message}`));
        }

        let checkoutUrl;
        if (online) {
            checkoutUrl = await createPaymentPreference(order.$id, priced.total);
            if (!checkoutUrl) {
                // Sin enlace de pago el pedido no se puede completar: se deshace todo.
                for (const id of created) await db.deleteRow({ databaseId: DB, tableId: ITEMS, rowId: id }).catch(() => {});
                await db.deleteRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id }).catch(() => {});
                return fail(res, 502, 'payment_unavailable', 'No se pudo iniciar el pago en línea. Inténtalo de nuevo.');
            }
            await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data: { paymentUrl: checkoutUrl } });
        }

        log(`order ${order.$id} created`);
        return res.json({ orderId: order.$id, duplicate: false, ...(checkoutUrl ? { checkoutUrl } : {}) });
    } catch (e) {
        error(e.message);
        return fail(res, 500, 'internal', 'No se pudo crear el pedido.');
    }
};
