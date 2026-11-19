import { createHash } from 'node:crypto';
import { Client, ID, Messaging, Permission, Query, Role, TablesDB, Users } from 'node-appwrite';
import {
    buildCheckoutSessionParams, buildLowStockNotification, buildOrderEvent, checkStock, makeInventory, buildOrderReceivedNotification, buildPushRequest, isStripeCheckoutUrl,
    priceOrder, stripeRequest, validateAddressInput, checkCoverage, countOpenUnpaid, MAX_OPEN_UNPAID, countRecentOrders, MAX_ORDERS_PER_WINDOW, validatePaymentMethod, validatePhone
} from './rules.js';

const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;
const ITEMS = process.env.ORDER_ITEMS_TABLE_ID;
const MENU = process.env.MENU_TABLE_ID;
const CUSTOMIZATIONS = process.env.CUSTOMIZATIONS_TABLE_ID;
// Relacion producto <-> extras (tabla menu_customizations: columnas `menu` y `customizations`).
const MENU_CUSTOMIZATIONS = process.env.MENU_CUSTOMIZATIONS_TABLE_ID;
const EVENTS = process.env.ORDER_EVENTS_TABLE_ID; // opcional: historial de cambios
// Historial de movimientos de inventario. Sin esta variable el control de existencias queda DESACTIVADO.
const MOVES = process.env.INVENTORY_MOVES_TABLE_ID;
const DELIVERY_FEE = Number(process.env.DELIVERY_FEE ?? 5);
const DISCOUNT = Number(process.env.DISCOUNT ?? 0.5);
// Pago en linea (Stripe Checkout alojado). Sin estas variables el pago en linea se rechaza.
// STRIPE_SECRET_KEY vive SOLO aqui (variable de la Function), nunca en la app ni en EXPO_PUBLIC_*.
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const PAYMENT_RETURN_URL = process.env.PAYMENT_RETURN_URL;
// Version del codigo desplegado: la app y `action: "diag"` la usan para detectar una Function desactualizada.
const BACKEND_VERSION = 'v10';

/**
 * Crea la sesion de Stripe Checkout con el importe calculado en el servidor.
 * La clave de idempotencia ligada al pedido evita crear dos sesiones (y dos cobros) por reintentos.
 */
async function createCheckoutSession(orderId, userId, total, logError = () => {}) {
    const res = await stripeRequest({
        secret: STRIPE_KEY,
        path: '/v1/checkout/sessions',
        params: buildCheckoutSessionParams({ orderId, userId, total, returnUrl: PAYMENT_RETURN_URL }),
        idempotencyKey: `checkout-${orderId}-1`
    });
    const s = res.data;
    if (!res.ok || !s || typeof s.id !== 'string' || !isStripeCheckoutUrl(s.url)) {
        // Diagnostico sin datos sensibles: solo estado HTTP y tipo/codigo/parametro del error de Stripe (nunca la clave).
        const e = (s && s.error) || {};
        logError(`stripe_checkout_failed status=${res.status} type=${e.type || '-'} code=${e.code || '-'} param=${e.param || '-'} msg=${String(e.message || '').replace(/(sk|rk|pk)_[A-Za-z0-9_]+/g, '[clave]').slice(0, 160)}`);
        return null;
    }
    return { id: s.id, url: s.url };
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
    const messaging = new Messaging(client);

    // Notificacion push (Appwrite Messaging). Mejor esfuerzo: nunca bloquea ni hace fallar el pedido.
    const notify = async (accountId, message) => {
        const req = buildPushRequest(accountId, message);
        if (!req) return;
        try {
            await messaging.createPush({ messageId: ID.unique(), ...req });
        } catch (e) {
            error(`push_failed: ${e.message}`);
        }
    };

    let body;
    try {
        body = typeof req.bodyJson === 'object' && req.bodyJson ? req.bodyJson : JSON.parse(req.bodyText || '{}');
    } catch {
        return fail(res, 400, 'bad_json', 'Cuerpo inválido.');
    }

    // Diagnostico de despliegue (solo booleanos, nunca valores): sirve para comprobar que la Function es esta version y esta configurada.
    if (body.action === 'diag') {
        return res.json({
            backend: BACKEND_VERSION,
            stripeKey: !!STRIPE_KEY,
            returnUrl: !!PAYMENT_RETURN_URL,
            inventoryMoves: !!process.env.INVENTORY_MOVES_TABLE_ID,
            menuTable: !!process.env.MENU_TABLE_ID,
            coverage: !!(process.env.RESTAURANT_LATITUDE && process.env.RESTAURANT_LONGITUDE && process.env.DELIVERY_RADIUS_KM)
        });
    }

    const { clientRequestId, address, contact, items } = body;
    if (typeof clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId)) {
        return fail(res, 400, 'bad_request_id', 'Falta el identificador del intento.');
    }
    const addr = validateAddressInput(address);
    if (!addr.ok) return fail(res, 400, addr.code, addr.error);
    const cover = checkCoverage({
        restaurantLat: process.env.RESTAURANT_LATITUDE,
        restaurantLng: process.env.RESTAURANT_LONGITUDE,
        radiusKm: process.env.DELIVERY_RADIUS_KM,
        address: addr
    });
    if (!cover.ok) return fail(res, 422, cover.code, cover.error);
    const phone = validatePhone(contact && contact.phone);
    if (!phone.ok) return fail(res, 400, phone.code, phone.error);
    const pay = validatePaymentMethod(body.paymentMethod);
    if (!pay.ok) return fail(res, 400, pay.code, pay.error);
    const online = pay.method === 'online';
    if (online && (!STRIPE_KEY || !PAYMENT_RETURN_URL)) {
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
            // Un reintento nunca crea otro pedido ni otro cobro; si falta pagar, el cliente usa "Pagar ahora" (action payOrder).
            return res.json({
                orderId: existing.rows[0].$id, duplicate: true, backend: BACKEND_VERSION,
                paymentMethod: existing.rows[0].paymentMethod || 'cash_on_delivery', paymentStatus: existing.rows[0].paymentStatus || null
            });
        }

        // Limites anti-abuso: demasiados pedidos seguidos (cualquier metodo) o muchos pedidos en linea sin pagar.
        {
            const recent = (await db.listRows({
                databaseId: DB, tableId: ORDERS,
                queries: [Query.equal('userId', userId), Query.orderDesc('$createdAt'), Query.limit(30)]
            })).rows;
            if (countRecentOrders(recent) >= MAX_ORDERS_PER_WINDOW) {
                return fail(res, 429, 'rate_limited', 'Estás haciendo muchos pedidos seguidos. Espera unos minutos e inténtalo de nuevo.');
            }
            if (online && countOpenUnpaid(recent) >= MAX_OPEN_UNPAID) {
                return fail(res, 429, 'too_many_open_orders', 'Tienes varios pedidos en línea sin pagar. Paga o cancela alguno antes de crear otro.');
            }
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

        // Inventario: validacion previa (mensaje claro) y reserva atomica mas abajo (la que de verdad protege).
        const menuById = Object.fromEntries(menuRows.map((r) => [r.$id, r]));
        const stockCheck = MOVES ? checkStock(priced.lines, menuById) : { ok: true, totals: {} };
        if (!stockCheck.ok) return fail(res, 409, stockCheck.code, stockCheck.error);

        // El nombre sale de la cuenta, no del cliente.
        const account = await users.get({ userId });

        // Reserva de existencias ANTES de crear el pedido (descuento atomico en el servidor). Con el id del pedido
        // decidido de antemano, cualquier fallo posterior puede devolver exactamente lo reservado (idempotente).
        const orderId = ID.unique();
        const inventory = makeInventory({ db, DB, MENU, MOVES, Query, hash: (s) => createHash('sha256').update(s).digest('hex') });
        let reservation;
        try {
            reservation = await inventory.reserve({ orderId, totals: stockCheck.totals, menuById });
        } catch (e) {
            error(`reserve_failed: ${e.message}${e.leak ? ` LEAK menu=${e.leak.menuId} qty=${e.leak.qty}` : ''}`);
            return fail(res, 500, 'internal', 'No se pudo reservar el inventario.');
        }
        if (!reservation.ok) return fail(res, 409, reservation.code, reservation.error);
        const rollbackStock = async () => {
            if (!inventory.enabled) return;
            await inventory.release(orderId, 'order_rolled_back').catch((e) => error(`release_failed order=${orderId}: ${e.message}`));
        };

        let order;
        try {
            order = await db.createRow({
                databaseId: DB, tableId: ORDERS, rowId: orderId, permissions,
                data: {
                    userId,
                    status: 'pending',
                    subtotal: priced.subtotal,
                    total: priced.total,
                    deliveryFee: priced.deliveryFee,
                    discount: priced.discount,
                    paymentMethod: pay.method,
                    paymentStatus: online ? 'pending' : 'not_required',
                    // true => hay existencias reservadas que se devuelven al cancelar. Las Functions que cancelan se
                    // niegan a hacerlo si no pueden devolverlas (INVENTORY_MOVES_TABLE_ID ausente).
                    stockReserved: reservation.reserved.length > 0,
                    clientRequestId,
                    customerName: String(account.name ?? '').slice(0, 80),
                    customerPhone: phone.phone.slice(0, 20),
                    deliveryAddress: addr.line,
                    deliveryAddressLabel: addr.label,
                    deliveryLatitude: addr.latitude,
                    deliveryLongitude: addr.longitude
                }
            });
        } catch (e) {
            await rollbackStock();
            // Dos solicitudes simultaneas con el mismo intento: el indice unico deja pasar solo una; la otra devuelve ese pedido.
            if (e && (e.code === 409 || /already exists/i.test(String(e.message || '')))) {
                const again = await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('clientRequestId', clientRequestId), Query.limit(1)] });
                if (again.rows[0] && again.rows[0].userId === userId) return res.json({ orderId: again.rows[0].$id, duplicate: true });
                return fail(res, 409, 'conflict', 'Identificador en uso.');
            }
            throw e;
        }

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
            await rollbackStock();
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
            const session = await createCheckoutSession(order.$id, userId, priced.total, error);
            let saved = false;
            if (session) {
                try {
                    await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data: { stripeSessionId: session.id } });
                    saved = true;
                } catch (e) {
                    error(`session_save_failed: ${e.message}`);
                    await stripeRequest({ secret: STRIPE_KEY, path: `/v1/checkout/sessions/${session.id}/expire` });
                }
            }
            if (!saved) {
                // Sin sesion de pago el pedido no se puede completar: se deshace todo (tambien el inventario).
                await rollbackStock();
                for (const id of created) await db.deleteRow({ databaseId: DB, tableId: ITEMS, rowId: id }).catch(() => {});
                await db.deleteRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id }).catch(() => {});
                return fail(res, 502, 'payment_unavailable', 'No se pudo iniciar el pago en línea. Inténtalo de nuevo.');
            }
            checkoutUrl = session.url;
        } else {
            // Efectivo: el pedido ya esta recibido. En linea se avisa cuando Stripe confirma el pago.
            await notify(userId, buildOrderReceivedNotification(order.$id));
        }

        // Alerta de existencias bajas al personal (mejor esfuerzo, una vez al cruzar el umbral).
        if (reservation.low && reservation.low.length) {
            try {
                const staff = await users.list({ queries: [Query.equal('labels', ['staff', 'admin']), Query.limit(50)] });
                for (const l of reservation.low) for (const s of staff.users) await notify(s.$id, buildLowStockNotification(l.name, l.stock));
            } catch (e) {
                error(`low_stock_notify_failed: ${e.message}`);
            }
        }

        log(`order ${order.$id} created`);
        return res.json({
            orderId: order.$id, duplicate: false, backend: BACKEND_VERSION,
            paymentMethod: pay.method, paymentStatus: online ? 'pending' : 'not_required',
            ...(checkoutUrl ? { checkoutUrl } : {})
        });
    } catch (e) {
        error(e.message);
        return fail(res, 500, 'internal', 'No se pudo crear el pedido.');
    }
};
