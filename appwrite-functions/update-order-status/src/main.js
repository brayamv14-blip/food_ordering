
import { Client, Query, TablesDB, Users } from 'node-appwrite';
import {
    ACTIVE_DELIVERY,
    canActorTransition,
    canAssignDriver,
    toStaffOrderView,
    validateDriverPosition
} from './rules.js';

const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;
const ITEMS = process.env.ORDER_ITEMS_TABLE_ID;

const STATUSES = [
    'pending',
    'confirmed',
    'preparing',
    'on_the_way',
    'delivered',
    'cancelled'
];

const fail = (res, status, code, message) =>
    res.json({ code, error: message }, status);

export default async ({ req, res, error }) => {
    const userId = req.headers['x-appwrite-user-id'];

    if (!userId) {
        return fail(res, 401, 'unauthenticated', 'Inicia sesion.');
    }

    let body;

    try {
        body =
            req.bodyJson &&
            typeof req.bodyJson === 'object' &&
            !Array.isArray(req.bodyJson)
                ? req.bodyJson
                : JSON.parse(req.bodyText || '{}');

        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return fail(res, 400, 'bad_json', 'Cuerpo invalido.');
        }
    } catch {
        return fail(res, 400, 'bad_json', 'Cuerpo invalido.');
    }

    const action = body.action ?? 'changeStatus';

    const client = new Client()
        .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
        .setKey(req.headers['x-appwrite-key']);

    const db = new TablesDB(client);
    const users = new Users(client);

    try {
        const me = await users.get({ userId });
        const labels = Array.isArray(me.labels) ? me.labels : [];
        const isStaff = labels.includes('staff');
        const isDriver = labels.includes('driver');

        const itemsFor = async (orders) => {
            if (orders.length === 0) return {};

            const rows = (
                await db.listRows({
                    databaseId: DB,
                    tableId: ITEMS,
                    queries: [
                        Query.equal(
                            'orderId',
                            orders.map((order) => order.$id)
                        ),
                        Query.limit(500)
                    ]
                })
            ).rows;

            const grouped = {};

            for (const row of rows) {
                (grouped[row.orderId] ??= []).push(row);
            }

            return grouped;
        };

        switch (action) {
            // --------------------------------------------------
            // ACTUALIZAR ESTADO DE UN PEDIDO
            // Mantiene el formato anterior: { orderId, status }
            // --------------------------------------------------
            case 'changeStatus': {
                const { orderId, status: to } = body;

                if (
                    typeof orderId !== 'string' ||
                    !orderId ||
                    typeof to !== 'string'
                ) {
                    return fail(
                        res,
                        400,
                        'bad_request',
                        'Datos incompletos.'
                    );
                }

                const actor = isStaff
                    ? 'staff'
                    : isDriver
                      ? 'driver'
                      : 'customer';

                const order = await db.getRow({
                    databaseId: DB,
                    tableId: ORDERS,
                    rowId: orderId
                });

                const isOwner = order.userId === userId;

                if (actor === 'driver' && order.driverUserId !== userId) {
                    return fail(
                        res,
                        403,
                        'forbidden',
                        'Este pedido no esta asignado a ti.'
                    );
                }

                if (actor === 'customer' && !isOwner) {
                    return fail(
                        res,
                        404,
                        'not_found',
                        'Pedido no encontrado.'
                    );
                }

                const verdict = canActorTransition({
                    actor,
                    isOwner,
                    from: order.status,
                    to,
                    hasDriver: !!order.driverUserId
                });

                if (!verdict.ok) {
                    const status =
                        verdict.code === 'forbidden' ? 403 : 409;

                    return fail(
                        res,
                        status,
                        verdict.code,
                        verdict.error
                    );
                }

                const data = { status: to };

                if (to === 'delivered' || to === 'cancelled') {
                    data.driverLatitude = null;
                    data.driverLongitude = null;
                    data.driverUpdatedAt = null;
                }

                const updated = await db.updateRow({
                    databaseId: DB,
                    tableId: ORDERS,
                    rowId: orderId,
                    data
                });

                return res.json({
                    orderId: updated.$id,
                    status: updated.status
                });
            }

            // --------------------------------------------------
            // ACTUALIZAR UBICACION DEL REPARTIDOR
            // --------------------------------------------------
            case 'updateDriverLocation': {
                const { orderId, latitude, longitude } = body;

                if (typeof orderId !== 'string' || !orderId) {
                    return fail(
                        res,
                        400,
                        'bad_request',
                        'Falta el pedido.'
                    );
                }

                if (!isDriver) {
                    return fail(
                        res,
                        403,
                        'forbidden',
                        'Solo repartidores.'
                    );
                }

                const order = await db.getRow({
                    databaseId: DB,
                    tableId: ORDERS,
                    rowId: orderId
                });

                if (order.driverUserId !== userId) {
                    return fail(
                        res,
                        403,
                        'forbidden',
                        'Pedido no asignado a ti.'
                    );
                }

                if (order.status !== 'on_the_way') {
                    return fail(
                        res,
                        409,
                        'not_on_the_way',
                        'El pedido no esta en camino.'
                    );
                }

                const parsedLast = order.driverUpdatedAt
                    ? Date.parse(order.driverUpdatedAt)
                    : null;

                const lastUpdateMs =
                    parsedLast !== null && !Number.isNaN(parsedLast)
                        ? parsedLast
                        : null;

                const check = validateDriverPosition({
                    latitude,
                    longitude,
                    lastUpdateMs
                });

                if (!check.ok) {
                    return fail(
                        res,
                        check.code === 'rate_limited' ? 429 : 400,
                        check.code,
                        check.error
                    );
                }

                await db.updateRow({
                    databaseId: DB,
                    tableId: ORDERS,
                    rowId: orderId,
                    data: {
                        driverLatitude: check.latitude,
                        driverLongitude: check.longitude,
                        driverUpdatedAt: new Date().toISOString()
                    }
                });

                return res.json({ ok: true });
            }

            // --------------------------------------------------
            // LISTAR PEDIDOS PARA EL PERSONAL
            // --------------------------------------------------
            case 'listOrders': {
                if (!isStaff) {
                    return fail(
                        res,
                        403,
                        'forbidden',
                        'Solo personal autorizado.'
                    );
                }

                const queries = [
                    Query.orderDesc('$createdAt'),
                    Query.limit(50)
                ];

                if (body.status !== undefined) {
                    if (!STATUSES.includes(body.status)) {
                        return fail(
                            res,
                            400,
                            'bad_status',
                            'Estado invalido.'
                        );
                    }

                    queries.unshift(Query.equal('status', body.status));
                }

                const orders = (
                    await db.listRows({
                        databaseId: DB,
                        tableId: ORDERS,
                        queries
                    })
                ).rows;

                const groupedItems = await itemsFor(orders);

                return res.json({
                    orders: orders.map((order) =>
                        toStaffOrderView(
                            order,
                            groupedItems[order.$id] ?? []
                        )
                    )
                });
            }

            // --------------------------------------------------
            // LISTAR REPARTIDORES
            // --------------------------------------------------
            case 'listDrivers': {
                if (!isStaff) {
                    return fail(
                        res,
                        403,
                        'forbidden',
                        'Solo personal autorizado.'
                    );
                }

                const list = await users.list({
                    queries: [
                        Query.equal('labels', ['driver']),
                        Query.limit(50)
                    ]
                });

                return res.json({
                    drivers: list.users.map((driver) => ({
                        id: driver.$id,
                        name: driver.name || 'Repartidor'
                    }))
                });
            }

            // --------------------------------------------------
            // ASIGNAR UN REPARTIDOR
            // --------------------------------------------------
            case 'assignDriver': {
                if (!isStaff) {
                    return fail(
                        res,
                        403,
                        'forbidden',
                        'Solo personal autorizado.'
                    );
                }

                const { orderId, driverUserId } = body;

                if (
                    typeof orderId !== 'string' ||
                    !orderId ||
                    typeof driverUserId !== 'string' ||
                    !driverUserId
                ) {
                    return fail(
                        res,
                        400,
                        'bad_request',
                        'Datos incompletos.'
                    );
                }

                const driver = await users
                    .get({ userId: driverUserId })
                    .catch(() => null);

                if (
                    !driver ||
                    !Array.isArray(driver.labels) ||
                    !driver.labels.includes('driver')
                ) {
                    return fail(
                        res,
                        422,
                        'not_a_driver',
                        'Esa cuenta no es repartidor.'
                    );
                }

                const order = await db.getRow({
                    databaseId: DB,
                    tableId: ORDERS,
                    rowId: orderId
                });

                if (!canAssignDriver(order.status)) {
                    return fail(
                        res,
                        409,
                        'not_assignable',
                        'El pedido ya termino.'
                    );
                }

                const changed = order.driverUserId !== driverUserId;

                const data = {
                    driverUserId,
                    driverName: String(
                        driver.name || 'Repartidor'
                    ).slice(0, 80)
                };

                if (changed) {
                    data.driverLatitude = null;
                    data.driverLongitude = null;
                    data.driverUpdatedAt = null;
                }

                const updated = await db.updateRow({
                    databaseId: DB,
                    tableId: ORDERS,
                    rowId: orderId,
                    data
                });

                return res.json({
                    orderId: updated.$id,
                    driverName: updated.driverName
                });
            }

            // --------------------------------------------------
            // LISTAR ENTREGAS DEL REPARTIDOR ACTUAL
            // --------------------------------------------------
            case 'myDeliveries': {
                if (!isDriver) {
                    return fail(
                        res,
                        403,
                        'forbidden',
                        'Solo repartidores.'
                    );
                }

                const orders = (
                    await db.listRows({
                        databaseId: DB,
                        tableId: ORDERS,
                        queries: [
                            Query.equal('driverUserId', userId),
                            Query.equal('status', ACTIVE_DELIVERY),
                            Query.orderDesc('$createdAt'),
                            Query.limit(20)
                        ]
                    })
                ).rows;

                const groupedItems = await itemsFor(orders);

                return res.json({
                    orders: orders.map((order) =>
                        toStaffOrderView(
                            order,
                            groupedItems[order.$id] ?? []
                        )
                    )
                });
            }

            default:
                return fail(
                    res,
                    400,
                    'bad_action',
                    'Accion no valida.'
                );
        }
    } catch (e) {
        error(e?.message || String(e));
        return fail(
            res,
            500,
            'internal',
            'No se pudo completar la operacion.'
        );
    }
};
