import { Client, Query, TablesDB, Users } from 'node-appwrite';
import { ACTIVE_DELIVERY, canAssignDriver, toStaffOrderView } from './rules.js';

const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;
const ITEMS = process.env.ORDER_ITEMS_TABLE_ID;
const STATUSES = ['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled'];

const fail = (res, status, code, error) => res.json({ code, error }, status);

/**
 * API para personal y repartidores. Las filas de `orders` solo son legibles por su
 * dueno, asi que el personal las consulta unicamente a traves de esta funcion.
 *   staff : listOrders, listDrivers, assignDriver
 *   driver: myDeliveries
 */
export default async ({ req, res, error }) => {
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

    try {
        const me = await users.get({ userId });
        const labels = me.labels ?? [];
        const isStaff = labels.includes('staff');
        const isDriver = labels.includes('driver');

        const itemsFor = async (orders) => {
            if (orders.length === 0) return {};
            const rows = (await db.listRows({
                databaseId: DB, tableId: ITEMS,
                queries: [Query.equal('orderId', orders.map((o) => o.$id)), Query.limit(500)]
            })).rows;
            const by = {};
            for (const r of rows) (by[r.orderId] ??= []).push(r);
            return by;
        };

        switch (body.action) {
            case 'listOrders': {
                if (!isStaff) return fail(res, 403, 'forbidden', 'Solo personal autorizado.');
                const queries = [Query.orderDesc('$createdAt'), Query.limit(50)];
                if (body.status !== undefined) {
                    if (!STATUSES.includes(body.status)) return fail(res, 400, 'bad_status', 'Estado inválido.');
                    queries.unshift(Query.equal('status', body.status));
                }
                const orders = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries })).rows;
                const items = await itemsFor(orders);
                return res.json({ orders: orders.map((o) => toStaffOrderView(o, items[o.$id] ?? [])) });
            }
            case 'listDrivers': {
                if (!isStaff) return fail(res, 403, 'forbidden', 'Solo personal autorizado.');
                const list = await users.list({ queries: [Query.equal('labels', ['driver']), Query.limit(50)] });
                return res.json({ drivers: list.users.map((u) => ({ id: u.$id, name: u.name || 'Repartidor' })) });
            }
            case 'assignDriver': {
                if (!isStaff) return fail(res, 403, 'forbidden', 'Solo personal autorizado.');
                const { orderId, driverUserId } = body;
                if (typeof orderId !== 'string' || typeof driverUserId !== 'string') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const driver = await users.get({ userId: driverUserId }).catch(() => null);
                if (!driver || !(driver.labels ?? []).includes('driver')) return fail(res, 422, 'not_a_driver', 'Esa cuenta no es repartidor.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (!canAssignDriver(order.status)) return fail(res, 409, 'not_assignable', 'El pedido ya terminó.');
                const changed = order.driverUserId !== driverUserId;
                const updated = await db.updateRow({
                    databaseId: DB, tableId: ORDERS, rowId: orderId,
                    // Si cambia el repartidor, se descarta la ubicacion del anterior.
                    data: { driverUserId, driverName: String(driver.name || 'Repartidor').slice(0, 80), ...(changed ? { driverLatitude: null, driverLongitude: null } : {}) }
                });
                return res.json({ orderId: updated.$id, driverName: updated.driverName });
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
            default:
                return fail(res, 400, 'bad_action', 'Acción no válida.');
        }
    } catch (e) {
        error(e.message);
        return fail(res, 500, 'internal', 'No se pudo completar la operación.');
    }
};
