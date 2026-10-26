import { Client, ID, Query, TablesDB, Users } from 'node-appwrite';
import {
    ACTIVE_DELIVERY, buildAssignmentNotification, buildOrderEvent, buildStatusNotification, canActorTransition,
    canAssignDriver, checkExpected, isExpoPushToken, latestPaymentStatus, matchesOrderQuery, parseDateRange,
    pickApprovedPayment, toStaffOrderView, tokensToPurge, validateDriverPosition
} from './rules.js';

/**
 * Funcion unica de operaciones sobre pedidos ya creados (la creacion vive en
 * `create-order`). Contrato por el campo `action` del cuerpo JSON:
 *
 *   updateStatus   (por omision)  cliente: cancelar propio pendiente | staff | driver asignado
 *   syncPayment                   dueno o staff: verifica el pago en linea (Mercado Pago)
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
const USERS_TABLE = process.env.USERS_TABLE_ID; // opcional: necesario para enviar notificaciones push
const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN; // opcional (seguridad extra del servicio push de Expo)
const MP_TOKEN = process.env.MP_ACCESS_TOKEN; // necesario solo para syncPayment
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

    // Notificaciones push (Expo Push Service). Mejor esfuerzo: nunca bloquea ni hace fallar la operacion.
    const notify = async (accountId, message) => {
        if (!USERS_TABLE || !message || !accountId) return;
        try {
            const rows = (await db.listRows({ databaseId: DB, tableId: USERS_TABLE, queries: [Query.equal('accountId', accountId), Query.limit(1)] })).rows;
            const profile = rows[0];
            const token = profile && profile.pushToken;
            if (!isExpoPushToken(token)) return;
            const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
            if (EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 8000);
            try {
                const resp = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify([{ to: token, ...message }]), signal: ctrl.signal });
                const json = await resp.json().catch(() => null);
                // Dispositivo dado de baja: se borra el token para no insistir.
                if (tokensToPurge(json, [token]).length > 0) {
                    await db.updateRow({ databaseId: DB, tableId: USERS_TABLE, rowId: profile.$id, data: { pushToken: null } });
                }
            } finally {
                clearTimeout(timer);
            }
        } catch (e) {
            error(`push_failed: ${e.message}`);
        }
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
                // Al terminar el pedido no se conserva la ubicacion del repartidor.
                if (to === 'delivered' || to === 'cancelled') {
                    data.driverLatitude = null;
                    data.driverLongitude = null;
                }
                const updated = await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data });
                await record({ orderId, type: 'status', from: order.status, to, actorId: userId, actorRole: actor, driverUserId: order.driverUserId ?? null });
                // Al cliente se le avisa de los cambios hechos por el restaurante o el repartidor (no de los suyos).
                if (actor !== 'customer') await notify(order.userId, buildStatusNotification(to, orderId));
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
                if (order.paymentStatus === 'paid') return res.json({ paymentStatus: 'paid', orderId });
                if (!MP_TOKEN) return fail(res, 503, 'payment_unavailable', 'La verificación de pagos no está configurada.');

                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 10000);
                let results;
                try {
                    const resp = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc`, {
                        headers: { Authorization: `Bearer ${MP_TOKEN}` }, signal: ctrl.signal
                    });
                    if (!resp.ok) return fail(res, 502, 'payment_unavailable', 'No se pudo consultar el pago. Inténtalo de nuevo.');
                    results = (await resp.json())?.results;
                } catch {
                    return fail(res, 502, 'payment_unavailable', 'No se pudo consultar el pago. Inténtalo de nuevo.');
                } finally {
                    clearTimeout(timer);
                }
                // Solo cuenta un pago aprobado por el importe EXACTO del pedido, calculado en el servidor.
                const approved = pickApprovedPayment(results, { total: order.total });
                if (!approved) return res.json({ paymentStatus: order.paymentStatus || 'pending', providerStatus: latestPaymentStatus(results), orderId });
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data: { paymentStatus: 'paid', paymentId: String(approved.id).slice(0, 64) } });
                await record({ orderId, type: 'payment_paid', from: order.status, to: order.status, actorId: userId, actorRole: actor });
                return res.json({ paymentStatus: 'paid', orderId });
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
                    queries: [Query.equal('driverUserId', userId), Query.equal('status', ACTIVE_DELIVERY), Query.orderDesc('$createdAt'), Query.limit(20)]
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
