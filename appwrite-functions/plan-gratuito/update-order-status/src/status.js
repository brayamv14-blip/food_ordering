import { createHash } from 'node:crypto';
import { Client, ID, Messaging, Query, TablesDB, Users } from 'node-appwrite';
import {
    ACTIVE_DELIVERY, buildAssignmentNotification, buildDriverRejectedNotification, makeInventory, pickDriver, buildCheckoutSessionParams, buildOrderEvent, buildPaymentNotification,
    buildPushRequest, buildStatusNotification, canActorTransition, canAssignDriver, checkExpected, checkSessionPayment,
    isStripeCheckoutUrl, matchesOrderQuery, movePaymentStatus, parseDateRange, paymentIntentId, stripeRequest,
    toStaffOrderView, validateDriverPosition, driverState, normalizeReason, planRefund, buildAuditEntry, POOL_STATUSES, IN_TRANSIT, toPoolView,
    buildDriverCancelledNotification, distanceKm, demoNextStep, demoDriverFor, demoPosition
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
const MENU = process.env.MENU_TABLE_ID;
const MOVES = process.env.INVENTORY_MOVES_TABLE_ID; // sin ella no se controla inventario
// Asignacion automatica de repartidor al pasar a "preparing" (apagada por omision).
const AUTO_ASSIGN = process.env.AUTO_ASSIGN_DRIVER === 'true';
const MAX_ACTIVE_PER_DRIVER = Number(process.env.MAX_ACTIVE_PER_DRIVER ?? 3);
const AUDIT = process.env.AUDIT_TABLE_ID; // opcional: registro de acciones administrativas
const RESTAURANT = (() => {
    const latitude = Number(process.env.RESTAURANT_LATITUDE), longitude = Number(process.env.RESTAURANT_LONGITUDE);
    return process.env.RESTAURANT_LATITUDE && process.env.RESTAURANT_LONGITUDE && Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
})();
// MODO DEMOSTRACION (apagado por omision): avanza pedidos solos con repartidores FICTICIOS. Solo para presentar la app.
const DEMO = process.env.DEMO_AUTOPILOT === 'true';
const DEMO_TRIP_SECONDS = Number(process.env.DEMO_TRIP_SECONDS) > 0 ? Number(process.env.DEMO_TRIP_SECONDS) : 90;
const STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivery_failed', 'delivered', 'cancelled'];

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

    const inventory = makeInventory({ db, DB, MENU, MOVES, Query, hash: (s) => createHash('sha256').update(s).digest('hex') });
    /** Devuelve el stock reservado del pedido (idempotente). Un fallo se registra y se puede reintentar. */
    const releaseStock = async (orderId) => {
        try {
            await inventory.release(orderId);
            return true;
        } catch (e) {
            error(`release_failed order=${orderId}: ${e.message}`);
            return false;
        }
    };
    const notifyStaff = async (message) => {
        try {
            const staff = await users.list({ queries: [Query.equal('labels', ['staff', 'admin']), Query.limit(50)] });
            for (const s of staff.users) await notify(s.$id, message);
        } catch (e) {
            error(`staff_notify_failed: ${e.message}`);
        }
    };
    const driverIsAvailable = (u) => !(u && u.prefs && u.prefs.driverAvailable === false) && !(u && u.status === false);

    // ---- Candado atomico por fila unica. Appwrite no tiene escritura condicional, pero SI garantiza que un `rowId`
    // no se repite: crear una fila con id determinista (pedido + version leida) permite que, de varios intentos
    // simultaneos desde la misma version, solo UNO gane (los demas reciben 409). La fila es a la vez el evento del historial.
    // Sin ORDER_EVENTS_TABLE_ID no hay candado (devuelve null) y solo queda la verificacion posterior (mas debil).
    const lockId = (kind, orderId, version, extra = '') => 'k' + createHash('sha256').update(`${kind}:${orderId}:${version}:${extra}`).digest('hex').slice(0, 34);
    const takeLock = async (kind, orderId, version, event, extra = '') => {
        if (!EVENTS) return null;
        try {
            await db.createRow({ databaseId: DB, tableId: EVENTS, rowId: lockId(kind, orderId, version, extra), data: buildOrderEvent(event) });
            return true;
        } catch (e) {
            if (e && (e.code === 409 || /already exists/i.test(String(e.message || '')))) return false;
            throw e;
        }
    };
    const dropLock = async (kind, orderId, version, extra = '') => {
        if (!EVENTS) return;
        try { await db.deleteRow({ databaseId: DB, tableId: EVENTS, rowId: lockId(kind, orderId, version, extra) }); } catch (e) { error(`lock_release_failed: ${e.message}`); }
    };
    /** Registro de acciones administrativas importantes (mejor esfuerzo; siempre queda ademas en el log de la Function). */
    const audit = async (action, targetType, targetId, summary, role) => {
        log(`audit action=${action} target=${targetType}:${targetId} actor=${userId}`);
        if (!AUDIT) return;
        try { await db.createRow({ databaseId: DB, tableId: AUDIT, rowId: ID.unique(), data: buildAuditEntry({ actorId: userId, actorRole: role, action, targetType, targetId, summary }) }); } catch (e) { error(`audit_failed: ${e.message}`); }
    };
    /** Entregas activas por repartidor (todas, con tope de 200 filas activas). */
    const driverLoads = async () => {
        const active = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('status', ACTIVE_DELIVERY), Query.limit(200)] })).rows;
        const load = {}, transit = {};
        for (const o of active) {
            if (!o.driverUserId) continue;
            load[o.driverUserId] = (load[o.driverUserId] || 0) + 1;
            if (IN_TRANSIT.includes(o.status)) transit[o.driverUserId] = (transit[o.driverUserId] || 0) + 1;
        }
        return { active, load, transit };
    };
    const stateOf = (u, loads) => driverState({
        available: driverIsAvailable(u) ? true : false, lastSeenAt: u.prefs && u.prefs.driverLastSeenAt, active: loads.load[u.$id] || 0, inTransit: loads.transit[u.$id] || 0, maxActive: MAX_ACTIVE_PER_DRIVER
    });
    const driverView = (u, loads) => {
        const s = stateOf(u, loads);
        return { id: u.$id, name: u.name || 'Repartidor', available: driverIsAvailable(u), status: s.status, connected: s.connected, lastSeenAt: s.lastSeenAt, activeOrders: loads.load[u.$id] || 0, inTransit: loads.transit[u.$id] || 0, userActive: !(u.status === false) };
    };
    /** Asignacion automatica: repartidor disponible con menos entregas activas. Devuelve true si asigno. */
    const autoAssign = async (order, excludeId = null) => {
        if (!AUTO_ASSIGN || order.driverUserId) return false;
        const list = await users.list({ queries: [Query.equal('labels', ['driver']), Query.limit(50)] });
        const loads = await driverLoads();
        const chosen = pickDriver(
            list.users.filter((u) => u.$id !== excludeId).map((u) => {
                const s = stateOf(u, loads);
                // Solo conectados y sin ultima senal vencida; "ocupado" (en transito) queda fuera.
                return { id: u.$id, name: u.name, available: driverIsAvailable(u) && !s.stale && s.status !== 'busy', active: loads.load[u.$id] || 0 };
            }),
            { maxActive: MAX_ACTIVE_PER_DRIVER }
        );
        if (!chosen) return false;
        await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data: { driverUserId: chosen.id, driverName: String(chosen.name || 'Repartidor').slice(0, 80), driverResponse: 'pending', driverLatitude: null, driverLongitude: null } });
        await record({ orderId: order.$id, type: 'driver_assigned', from: order.status, to: order.status, actorId: 'system', actorRole: 'system', driverUserId: chosen.id });
        await notify(chosen.id, buildAssignmentNotification(order.$id));
        return true;
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
        const isStaff = labels.includes('staff') || labels.includes('admin');
        const isDriver = labels.includes('driver');
        const actor = isStaff ? 'staff' : isDriver ? 'driver' : 'customer';
        const needStaff = () => (isStaff ? null : fail(res, 403, 'forbidden', 'Solo personal autorizado.'));
        const needAdmin = () => (labels.includes('admin') ? null : fail(res, 403, 'forbidden', 'Solo administradores.'));
        /** Marca la ultima senal del repartidor (como mucho 1 vez por minuto). Relee las preferencias para no pisar cambios recientes. */
        const touchDriver = async () => {
            if (!isDriver) return;
            const seen = me.prefs && me.prefs.driverLastSeenAt ? Date.parse(me.prefs.driverLastSeenAt) : 0;
            if (seen && Date.now() - seen < 60000) return;
            try {
                const fresh = await users.get({ userId });
                await users.updatePrefs({ userId, prefs: { ...(fresh.prefs || {}), driverLastSeenAt: new Date().toISOString() } });
            } catch (e) {
                error(`touch_failed: ${e.message}`);
            }
        };

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
                    actor, isOwner, from: order.status, to, hasDriver: !!order.driverUserId, driverAccepted: (order.driverResponse || 'accepted') === 'accepted',
                    payment: { method: order.paymentMethod || 'cash_on_delivery', status: order.paymentStatus || null }
                });
                if (!verdict.ok) return fail(res, verdict.code === 'forbidden' ? 403 : 409, verdict.code, verdict.error);
                // Motivo: obligatorio cuando el personal cancela; opcional en las demas incidencias (p. ej. entrega fallida).
                const why = normalizeReason(body.reason, { required: to === 'cancelled' && actor === 'staff' });
                if (!why.ok) return fail(res, 400, why.code, why.error);

                // Cancelar devuelve existencias: si el pedido las reservo y esta Function no puede devolverlas
                // (falta INVENTORY_MOVES_TABLE_ID), se rechaza ANTES de reembolsar o cancelar: nada se pierde en silencio.
                if (to === 'cancelled' && order.stockReserved === true && !inventory.enabled) {
                    error(`inventory_misconfigured order=${orderId}`);
                    return fail(res, 503, 'inventory_unavailable', 'El inventario no está configurado en el servidor; no se puede cancelar sin devolver existencias.');
                }
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
                        // Si ya hubo un reembolso parcial, solo se devuelve lo que falta (Stripe rechazaria pasarse del cobro).
                        const doneCents = Math.round(Number(order.refundedAmount || 0) * 100);
                        const refundParams = [['payment_intent', pi], ['metadata[orderId]', orderId]];
                        let refundKey = `refund-${orderId}`;
                        if (doneCents > 0) {
                            const remaining = Math.round(Number(order.total) * 100) - doneCents;
                            refundParams.push(['amount', String(remaining)]);
                            refundKey = `refund-${orderId}-${doneCents}-${remaining}`;
                        }
                        const refund = await stripe({ path: '/v1/refunds', params: refundParams, idempotencyKey: refundKey });
                        if (!refund.ok || !refund.data || !['succeeded', 'pending'].includes(refund.data.status)) {
                            return fail(res, 502, 'refund_failed', 'No se pudo emitir el reembolso. El pedido no se canceló; inténtalo de nuevo.');
                        }
                        data.paymentStatus = 'refunded';
                        if (doneCents > 0) data.refundedAmount = order.total; // solo si hubo parciales (la columna la crea la migracion v11)
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
                if (to === 'delivered' || to === 'cancelled' || to === 'delivery_failed') {
                    data.driverLatitude = null;
                    data.driverLongitude = null;
                }
                const previousStatus = order.status; // (un doble de pruebas puede mutar `order` al escribir)
                const updated = await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data });
                // Si el repartidor salio directo desde "listo", queda constancia de que recogio el pedido (quien y cuando).
                if (to === 'on_the_way' && ['preparing', 'ready'].includes(previousStatus) && order.driverUserId) {
                    await record({ orderId, type: 'status', from: previousStatus, to: 'picked_up', actorId: userId, actorRole: actor, driverUserId: order.driverUserId, note: 'recogida implícita al salir a reparto' });
                }
                await record({ orderId, type: 'status', from: previousStatus, to, actorId: userId, actorRole: actor, driverUserId: order.driverUserId ?? null, note: why.reason });
                if (to === 'cancelled' && order.driverUserId && actor !== 'driver') await notify(order.driverUserId, buildDriverCancelledNotification(orderId));
                // Al cliente se le avisa de los cambios hechos por el restaurante o el repartidor (no de los suyos).
                if (refunded) await record({ orderId, type: 'payment_refunded', from: order.status, to, actorId: userId, actorRole: actor });
                // Cancelar devuelve el stock reservado (tambien tras un reembolso). Idempotente: no se devuelve dos veces.
                let stockRelease = 'n/a';
                if (to === 'cancelled' && order.stockReserved === true) {
                    stockRelease = (await releaseStock(orderId)) ? 'done' : 'pending';
                    if (stockRelease === 'pending') await record({ orderId, type: 'stock_release_failed', from: order.status, to, actorId: userId, actorRole: actor });
                }
                if (actor !== 'customer') await notify(order.userId, buildStatusNotification(to, orderId));
                if (to === 'preparing' && !order.driverUserId) await autoAssign(updated).catch((e) => error(`auto_assign_failed: ${e.message}`));
                if (refunded) await notify(order.userId, buildPaymentNotification('refunded', orderId));
                return res.json({ orderId: updated.$id, status: updated.status, updatedAt: updated.$updatedAt ?? null, ...(stockRelease === 'pending' ? { stockRelease } : {}) });
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

            case 'advanceDemo': {
                // Simulacion: confirmado -> preparando -> listo -> recogido -> en camino -> entregado, con repartidor ficticio.
                if (!DEMO) return fail(res, 403, 'demo_disabled', 'El modo demostración no está activo.');
                if (!EVENTS) return fail(res, 503, 'demo_needs_events', 'El modo demostración necesita ORDER_EVENTS_TABLE_ID.');
                const { orderId } = body;
                if (typeof orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                let order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (actor === 'customer' && order.userId !== userId) return fail(res, 404, 'not_found', 'Pedido no encontrado.');
                if (actor === 'driver') return fail(res, 403, 'forbidden', 'No tienes permiso para esta acción.');
                if (['delivered', 'cancelled', 'delivery_failed'].includes(order.status)) return res.json({ status: order.status, done: true, advanced: false });

                // Pago en linea: se confirma con Stripe en el servidor; hasta entonces el pedido no avanza.
                if (order.paymentMethod === 'online' && order.paymentStatus !== 'paid') {
                    if (STRIPE_KEY && order.stripeSessionId && !['failed', 'cancelled', 'refunded'].includes(order.paymentStatus || 'pending')) {
                        const session = await getSession(order);
                        if (session && checkSessionPayment(session, { orderId, total: order.total }).state === 'paid') {
                            await markPaid(order, session, { id: userId, role: actor });
                            order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                        }
                    }
                    if (order.paymentStatus !== 'paid') return res.json({ status: order.status, advanced: false, waiting: 'payment', paymentStatus: order.paymentStatus || 'pending' });
                }

                const plan = demoNextStep(order.status, DEMO_TRIP_SECONDS);
                if (!plan) return res.json({ status: order.status, advanced: false });
                const events = (await db.listRows({ databaseId: DB, tableId: EVENTS, queries: [Query.equal('orderId', orderId), Query.orderDesc('$createdAt'), Query.limit(30)] })).rows;
                const enteredAt = (events.find((e) => e.type === 'status' && e.toStatus === order.status) || {}).$createdAt || order.$createdAt;
                const sinceMs = Date.now() - Date.parse(enteredAt);
                const elapsed = Number.isFinite(sinceMs) ? Math.max(0, sinceMs / 1000) : 0;
                const destination = typeof order.deliveryLatitude === 'number' && typeof order.deliveryLongitude === 'number'
                    ? { latitude: order.deliveryLatitude, longitude: order.deliveryLongitude } : null;
                const isDemoDriver = typeof order.driverUserId === 'string' && order.driverUserId.startsWith('demo-driver-');

                if (elapsed < plan.delay) {
                    // Aun no toca cambiar de estado: solo se mueve el repartidor ficticio (si ya hay uno).
                    if (isDemoDriver) {
                        const pos = demoPosition({ status: order.status, progress: elapsed / plan.delay, restaurant: RESTAURANT, destination });
                        if (pos) await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data: { driverLatitude: pos.latitude, driverLongitude: pos.longitude, driverUpdatedAt: new Date().toISOString() } });
                    }
                    return res.json({ status: order.status, advanced: false, nextInSeconds: Math.ceil(plan.delay - elapsed) });
                }

                const to = plan.to;
                const drv = to === 'preparing' && !order.driverUserId ? demoDriverFor(orderId) : null;
                const claimed = await takeLock('demo', orderId, order.status, { orderId, type: 'status', from: order.status, to, actorId: 'demo', actorRole: 'system', driverUserId: drv ? drv.id : (order.driverUserId ?? null), note: 'simulación (modo demostración)' });
                if (claimed === false) return res.json({ status: order.status, advanced: false, busy: true });
                const data = { status: to };
                if (drv) {
                    data.driverUserId = drv.id;
                    data.driverName = drv.name;
                    data.driverResponse = 'accepted';
                }
                if (to === 'delivered') {
                    data.driverLatitude = null;
                    data.driverLongitude = null;
                } else if (drv || isDemoDriver) {
                    const pos = demoPosition({ status: to, progress: 0, restaurant: RESTAURANT, destination });
                    if (pos) Object.assign(data, { driverLatitude: pos.latitude, driverLongitude: pos.longitude, driverUpdatedAt: new Date().toISOString() });
                }
                try {
                    await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data });
                } catch (e) {
                    await dropLock('demo', orderId, order.status);
                    throw e;
                }
                await notify(order.userId, buildStatusNotification(to, orderId));
                return res.json({ status: to, advanced: true, driverName: drv ? drv.name : order.driverName ?? null });
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
                await touchDriver();
                return res.json({ ok: true });
            }

            case 'myDeliveries': {
                if (!isDriver) return fail(res, 403, 'forbidden', 'Solo repartidores.');
                await touchDriver();
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
                const loads = await driverLoads();
                return res.json({ drivers: list.users.map((u) => driverView(u, loads)) });
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
                // Mismo repartidor: no se vuelve a asignar ni a notificar (evita duplicados).
                if (!changed) return res.json({ orderId: order.$id, driverName: order.driverName, duplicate: true, updatedAt: order.$updatedAt ?? null });
                // Una vez recogido el pedido ya va en manos de otro repartidor: no se reasigna a mitad del trayecto.
                if (order.driverUserId && ['picked_up', 'on_the_way'].includes(order.status)) {
                    return fail(res, 409, 'in_transit', 'El pedido ya va en camino; no se puede cambiar de repartidor.');
                }
                if (!driverIsAvailable(driver)) return fail(res, 422, 'driver_unavailable', 'Ese repartidor no está disponible.');
                // Candado atomico: de varias asignaciones simultaneas desde la misma version del pedido, solo una avanza.
                const locked = await takeLock('assign', orderId, order.$updatedAt, { orderId, type: 'driver_assigned', from: order.status, to: order.status, actorId: userId, actorRole: 'staff', driverUserId });
                if (locked === false) return fail(res, 409, 'assignment_conflict', 'Otra persona asignó este pedido al mismo tiempo. Revisa el estado actual.');
                let updated;
                try {
                    updated = await db.updateRow({
                        databaseId: DB, tableId: ORDERS, rowId: orderId,
                        // Si cambia el repartidor, se descarta la ubicacion del anterior.
                        data: { driverUserId, driverName: String(driver.name || 'Repartidor').slice(0, 80), driverResponse: 'pending', driverLatitude: null, driverLongitude: null }
                    });
                } catch (e) {
                    if (locked) await dropLock('assign', orderId, order.$updatedAt);
                    throw e;
                }
                // Sin escritura condicional en Appwrite: si otra persona del personal asigno a otro repartidor al mismo
                // tiempo, gana la ultima escritura. Se relee para que quien perdio reciba un 409 en vez de un falso exito
                // (y para no notificar a un repartidor que ya no tiene el pedido).
                const confirmed = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (confirmed.driverUserId !== driverUserId) {
                    return fail(res, 409, 'assignment_conflict', 'Otra persona asignó este pedido al mismo tiempo. Revisa el estado actual.');
                }
                if (locked === null) await record({ orderId, type: 'driver_assigned', from: order.status, to: order.status, actorId: userId, actorRole: 'staff', driverUserId });
                await notify(driverUserId, buildAssignmentNotification(orderId));
                return res.json({ orderId: updated.$id, driverName: updated.driverName, updatedAt: updated.$updatedAt ?? null });
            }

            case 'setAvailability': {
                if (!isDriver) return fail(res, 403, 'forbidden', 'Solo repartidores.');
                if (typeof body.available !== 'boolean') return fail(res, 400, 'bad_request', 'Indica si estás disponible.');
                // Las preferencias se reemplazan completas en Appwrite: se conservan las demas.
                const fresh = await users.get({ userId });
                await users.updatePrefs({ userId, prefs: { ...(fresh.prefs || {}), driverAvailable: body.available, driverLastSeenAt: new Date().toISOString() } });
                return res.json({ available: body.available });
            }

            case 'respondAssignment': {
                if (!isDriver) return fail(res, 403, 'forbidden', 'Solo repartidores.');
                const { orderId, accept } = body;
                if (typeof orderId !== 'string' || typeof accept !== 'boolean') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (order.driverUserId !== userId) return fail(res, 403, 'forbidden', 'Este pedido no está asignado a ti.');
                // Un pedido terminado (entregado/cancelado) ya no se acepta ni se rechaza: rechazarlo borraria el repartidor del historial.
                if (!canAssignDriver(order.status)) return fail(res, 409, 'not_assignable', 'El pedido ya terminó.');
                const current = order.driverResponse || 'accepted';
                if (accept) {
                    if (current === 'accepted') return res.json({ orderId, driverResponse: 'accepted', duplicate: true });
                    await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data: { driverResponse: 'accepted' } });
                    // Appwrite no tiene escritura condicional: si el personal reasigno el pedido entre la lectura y la
                    // escritura, la aceptacion habria caido sobre OTRO repartidor. Se relee y se revierte.
                    const check = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                    if (check.driverUserId !== userId) {
                        await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data: { driverResponse: 'pending' } });
                        return fail(res, 409, 'assignment_changed', 'El pedido fue reasignado a otra persona.');
                    }
                    await record({ orderId, type: 'driver_accepted', from: order.status, to: order.status, actorId: userId, actorRole: 'driver', driverUserId: userId });
                    return res.json({ orderId, driverResponse: 'accepted' });
                }
                // Rechazar solo se puede antes de recoger el pedido; despues, el personal debe atenderlo.
                if (['picked_up', 'on_the_way'].includes(order.status)) {
                    return fail(res, 409, 'in_transit', 'El pedido ya va en camino; avisa al personal.');
                }
                // Ultima comprobacion antes de borrar: si el personal ya reasigno, no se pisa la asignacion nueva.
                const fresh = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (fresh.driverUserId !== userId) return fail(res, 409, 'assignment_changed', 'El pedido fue reasignado a otra persona.');
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data: { driverUserId: null, driverName: null, driverResponse: null, driverLatitude: null, driverLongitude: null } });
                const rejWhy = normalizeReason(body.reason);
                await record({ orderId, type: 'driver_rejected', from: order.status, to: order.status, actorId: userId, actorRole: 'driver', driverUserId: userId, note: rejWhy.ok ? rejWhy.reason : null });
                const reassigned = await autoAssign({ ...order, driverUserId: null }, userId).catch((e) => { error(`auto_assign_failed: ${e.message}`); return false; });
                if (!reassigned) await notifyStaff(buildDriverRejectedNotification(orderId, me.name));
                return res.json({ orderId, driverResponse: 'rejected', reassigned });
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
                    events: rows.map((e) => ({ type: e.type, from: e.fromStatus ?? null, to: e.toStatus ?? null, actorRole: e.actorRole ?? null, actorId: e.actorId ?? null, driverUserId: e.driverUserId ?? null, note: e.note ?? null, at: e.$createdAt }))
                });
            }

            // ---------- v11: pedidos disponibles y reclamo atomico
            case 'availableOrders': {
                if (!isDriver) return fail(res, 403, 'forbidden', 'Solo repartidores.');
                await touchDriver();
                if (!driverIsAvailable(me)) return res.json({ orders: [], offline: true });
                const rows = (await db.listRows({
                    databaseId: DB, tableId: ORDERS,
                    queries: [Query.equal('status', POOL_STATUSES), Query.isNull('driverUserId'), Query.orderAsc('$createdAt'), Query.limit(30)]
                })).rows;
                const items = await itemsFor(rows);
                return res.json({
                    orders: rows.map((o) => {
                        const km = RESTAURANT && typeof o.deliveryLatitude === 'number' && typeof o.deliveryLongitude === 'number'
                            ? distanceKm(RESTAURANT, { latitude: o.deliveryLatitude, longitude: o.deliveryLongitude }) : null;
                        return toPoolView(o, items[o.$id] ?? [], km);
                    })
                });
            }

            case 'claimOrder': {
                if (!isDriver) return fail(res, 403, 'forbidden', 'Solo repartidores.');
                if (typeof body.orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                if (!driverIsAvailable(me)) return fail(res, 409, 'driver_offline', 'Ponte disponible para aceptar pedidos.');
                const orderId = body.orderId;
                const loads = await driverLoads();
                if ((loads.load[userId] || 0) >= MAX_ACTIVE_PER_DRIVER) return fail(res, 409, 'driver_busy', 'Ya tienes el máximo de entregas activas.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (order.driverUserId) {
                    return order.driverUserId === userId
                        ? res.json({ orderId, driverResponse: order.driverResponse || 'accepted', duplicate: true })
                        : fail(res, 409, 'already_taken', 'Otro repartidor ya tomó este pedido.');
                }
                if (!POOL_STATUSES.includes(order.status)) return fail(res, 409, 'not_available', 'El pedido ya no está disponible.');
                // Candado atomico (ver takeLock): dos repartidores que lo piden a la vez desde la misma version -> solo uno gana.
                const locked = await takeLock('claim', orderId, order.$updatedAt, { orderId, type: 'driver_claimed', from: order.status, to: order.status, actorId: userId, actorRole: 'driver', driverUserId: userId });
                if (locked === false) return fail(res, 409, 'already_taken', 'Otro repartidor ya tomó este pedido.');
                try {
                    await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: orderId, data: { driverUserId: userId, driverName: String(me.name || 'Repartidor').slice(0, 80), driverResponse: 'accepted', driverLatitude: null, driverLongitude: null } });
                } catch (e) {
                    if (locked) await dropLock('claim', orderId, order.$updatedAt);
                    throw e;
                }
                const confirmed = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: orderId });
                if (confirmed.driverUserId !== userId) return fail(res, 409, 'already_taken', 'Otro repartidor ya tomó este pedido.');
                if (locked === null) await record({ orderId, type: 'driver_claimed', from: order.status, to: order.status, actorId: userId, actorRole: 'driver', driverUserId: userId });
                await touchDriver();
                return res.json({ orderId, driverResponse: 'accepted' });
            }

            // ---------- v11: confirmacion de recepcion del cliente e incidencias
            case 'confirmReceipt': {
                if (typeof body.orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: body.orderId });
                if (order.userId !== userId) return fail(res, 404, 'not_found', 'Pedido no encontrado.');
                if (order.status !== 'delivered') return fail(res, 409, 'not_delivered', 'Solo puedes confirmar un pedido que ya fue entregado.');
                if (order.receivedAt) return res.json({ orderId: order.$id, receivedAt: order.receivedAt, duplicate: true });
                const at = new Date().toISOString();
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data: { receivedAt: at } });
                await record({ orderId: order.$id, type: 'received', from: 'delivered', to: 'delivered', actorId: userId, actorRole: 'customer', driverUserId: order.driverUserId ?? null });
                return res.json({ orderId: order.$id, receivedAt: at });
            }

            case 'reportIssue': {
                // El cliente avisa de un problema con SU pedido (no llego, llego incompleto...). Una vez por pedido.
                if (typeof body.orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                const why = normalizeReason(body.reason, { required: true });
                if (!why.ok) return fail(res, 400, why.code, why.error);
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: body.orderId });
                if (order.userId !== userId) return fail(res, 404, 'not_found', 'Pedido no encontrado.');
                if (!['on_the_way', 'delivered', 'delivery_failed'].includes(order.status)) return fail(res, 409, 'not_reportable', 'Todavía no puedes reportar un problema con este pedido.');
                if (!EVENTS) return fail(res, 503, 'history_disabled', 'El registro de incidencias no está configurado.');
                const locked = await takeLock('issue', order.$id, 'once', { orderId: order.$id, type: 'customer_issue', from: order.status, to: order.status, actorId: userId, actorRole: 'customer', driverUserId: order.driverUserId ?? null, note: why.reason });
                if (locked === false) return res.json({ orderId: order.$id, duplicate: true });
                await notifyStaff({ title: 'Problema reportado', body: `El cliente reportó un problema con el pedido #${String(order.$id).slice(-6)}.`, data: { type: 'customer_issue', orderId: order.$id } });
                return res.json({ orderId: order.$id, reported: true });
            }

            // ---------- v11: reembolsos (solo administrador; el importe lo valida y limita el servidor)
            case 'refundOrder': {
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.orderId !== 'string') return fail(res, 400, 'bad_request', 'Falta el pedido.');
                const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: body.orderId });
                const plan = planRefund({ order, amount: body.amount, reason: body.reason });
                if (!plan.ok) return fail(res, plan.status, plan.code, plan.error);
                if (!STRIPE_KEY) return fail(res, 503, 'payment_unavailable', 'El reembolso no está configurado.');
                const session = await getSession(order);
                const pi = paymentIntentId(session) || (typeof order.paymentId === 'string' ? order.paymentId : null);
                if (!pi) return fail(res, 502, 'refund_failed', 'No se pudo localizar el cobro para reembolsarlo.');
                const refund = await stripe({
                    path: '/v1/refunds',
                    params: [['payment_intent', pi], ['amount', String(plan.amountCents)], ['metadata[orderId]', order.$id]],
                    // Misma operacion (mismo acumulado previo + mismo importe) => Stripe devuelve el mismo reembolso, nunca dos.
                    idempotencyKey: `refund-${order.$id}-${plan.doneCents}-${plan.amountCents}`
                });
                if (!refund.ok || !refund.data || !['succeeded', 'pending'].includes(refund.data.status)) {
                    return fail(res, 502, 'refund_failed', 'No se pudo emitir el reembolso. Inténtalo de nuevo.');
                }
                const data = { refundedAmount: plan.afterCents / 100, ...(plan.full ? { paymentStatus: 'refunded' } : {}) };
                await db.updateRow({ databaseId: DB, tableId: ORDERS, rowId: order.$id, data });
                await record({ orderId: order.$id, type: 'payment_refunded', from: order.status, to: order.status, actorId: userId, actorRole: 'admin', note: `${plan.full ? 'total' : 'parcial'}: ${plan.reason}` });
                await audit('refund', 'order', order.$id, `${plan.full ? 'Reembolso total' : 'Reembolso parcial'} ${plan.amountCents / 100} (${plan.reason})`, 'admin');
                await notify(order.userId, buildPaymentNotification('refunded', order.$id));
                return res.json({ orderId: order.$id, refundedAmount: data.refundedAmount, paymentStatus: plan.full ? 'refunded' : 'paid', full: plan.full });
            }

            // ---------- v11: mapa y rendimiento de repartidores (personal)
            case 'driversMap': {
                const denied = needStaff();
                if (denied) return denied;
                const list = await users.list({ queries: [Query.equal('labels', ['driver']), Query.limit(50)] });
                const loads = await driverLoads();
                const unassigned = (await db.listRows({
                    databaseId: DB, tableId: ORDERS,
                    queries: [Query.equal('status', POOL_STATUSES), Query.isNull('driverUserId'), Query.limit(50)]
                })).rows;
                const point = (o) => ({
                    id: o.$id, status: o.status, driverUserId: o.driverUserId || null,
                    deliveryAddress: o.deliveryAddress || '',
                    deliveryLatitude: typeof o.deliveryLatitude === 'number' ? o.deliveryLatitude : null,
                    deliveryLongitude: typeof o.deliveryLongitude === 'number' ? o.deliveryLongitude : null,
                    driverLatitude: o.driverUserId && typeof o.driverLatitude === 'number' ? o.driverLatitude : null,
                    driverLongitude: o.driverUserId && typeof o.driverLongitude === 'number' ? o.driverLongitude : null,
                    driverUpdatedAt: o.driverUserId ? (o.driverUpdatedAt || null) : null
                });
                return res.json({
                    restaurant: RESTAURANT,
                    drivers: list.users.map((u) => driverView(u, loads)),
                    orders: loads.active.filter((o) => o.driverUserId).map(point),
                    unassigned: unassigned.map(point),
                    at: new Date().toISOString()
                });
            }

            case 'driverHistory': {
                const denied = needStaff();
                if (denied) return denied;
                if (typeof body.driverUserId !== 'string') return fail(res, 400, 'bad_request', 'Falta el repartidor.');
                const rows = (await db.listRows({
                    databaseId: DB, tableId: ORDERS,
                    queries: [Query.equal('driverUserId', body.driverUserId), Query.orderDesc('$createdAt'), Query.limit(100)]
                })).rows;
                const stats = { delivered: 0, failed: 0, cancelled: 0, active: 0 };
                for (const o of rows) {
                    if (o.status === 'delivered') stats.delivered++;
                    else if (o.status === 'delivery_failed') stats.failed++;
                    else if (o.status === 'cancelled') stats.cancelled++;
                    else stats.active++;
                }
                const items = await itemsFor(rows.slice(0, 50));
                return res.json({ stats, truncated: rows.length >= 100, orders: rows.slice(0, 50).map((o) => toStaffOrderView(o, items[o.$id] ?? [])) });
            }

            default:
                return fail(res, 400, 'bad_action', 'Acción no válida.');
        }
    } catch (e) {
        error(e.message);
        return fail(res, 500, 'internal', 'No se pudo completar la operación.');
    }
};
