import { Client, TablesDB, Users } from 'node-appwrite';
import { validateDriverPosition } from './rules.js';

const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;

const fail = (res, status, code, error) => res.json({ code, error }, status);

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
    const { orderId, latitude, longitude } = body;
    if (typeof orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');

    try {
        const user = await users.get({ userId });
        if (!(user.labels ?? []).includes('driver')) return fail(res, 403, 'forbidden', 'Solo repartidores.');

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
    } catch (e) {
        error(e.message);
        return fail(res, 500, 'internal', 'No se pudo actualizar la ubicación.');
    }
};
