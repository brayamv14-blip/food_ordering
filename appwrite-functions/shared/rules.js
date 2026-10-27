'use strict';
/**
 * Reglas de negocio ejecutadas en el servidor (Appwrite Functions, Node 18+).
 * Es JavaScript puro, sin dependencias, para poder probarlo con Jest y copiarlo
 * dentro de cada funcion al desplegar (ver appwrite-functions/README.md).
 */

const TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['on_the_way'],
    on_the_way: ['delivered'],
    delivered: [],
    cancelled: []
};

/** Que rol puede pedir cada transicion. El cliente solo cancela pedidos pendientes. */
function canActorTransition({ actor, isOwner, from, to, hasDriver = true, payment = null }) {
    if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) {
        return { ok: false, code: 'invalid_transition', error: 'Transición no permitida.' };
    }
    const online = !!payment && payment.method === 'online';
    // Un pedido con pago en linea no se confirma hasta que el pago este verificado en el servidor.
    if (to === 'confirmed' && online && payment.status !== 'paid') {
        return { ok: false, code: 'payment_required', error: 'El pago en línea aún no está confirmado.' };
    }
    // Reembolsos no se gestionan en la app: el cliente no cancela por su cuenta un pedido ya pagado.
    if (actor === 'customer' && to === 'cancelled' && online && payment.status === 'paid') {
        return { ok: false, code: 'refund_needed', error: 'Este pedido ya está pagado. Contacta al restaurante para cancelarlo y gestionar el reembolso.' };
    }
    if (to === 'on_the_way' && !hasDriver) {
        return { ok: false, code: 'driver_required', error: 'Asigna un repartidor antes de enviar el pedido.' };
    }
    if (actor === 'staff') return { ok: true };
    if (actor === 'driver') {
        if ((from === 'preparing' && to === 'on_the_way') || (from === 'on_the_way' && to === 'delivered')) {
            return { ok: true };
        }
        return { ok: false, code: 'forbidden', error: 'Un repartidor no puede hacer ese cambio.' };
    }
    // cliente
    if (isOwner && from === 'pending' && to === 'cancelled') return { ok: true };
    return { ok: false, code: 'forbidden', error: 'No tienes permiso para ese cambio.' };
}

const toCents = (n) => Math.round((Number(n) + Number.EPSILON) * 100);

/**
 * Recalcula el pedido con precios del menu y extras de la base de datos.
 * `menuById` y `extrasById` son mapas id -> fila leida con la API key del servidor.
 */
function priceOrder({ items, menuById, extrasById, allowedExtrasByMenu = null, deliveryFee = 5, discount = 0.5 }) {
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, code: 'empty_cart', error: 'El pedido no tiene productos.' };
    }
    if (items.length > 50) return { ok: false, code: 'too_many_items', error: 'Demasiados productos.' };

    const lines = [];
    let subtotalCents = 0;
    for (const it of items) {
        const menu = menuById[it.menuId];
        if (!menu) return { ok: false, code: 'unknown_menu', error: 'Producto inexistente.' };
        if (menu.available === false) {
            return { ok: false, code: 'unavailable', error: `“${menu.name}” ya no está disponible.` };
        }
        // Solo numeros enteros reales: no se aceptan textos como "2", "0x10" o "1e1".
        const qty = it.quantity;
        if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 50) {
            return { ok: false, code: 'bad_quantity', error: 'Cantidad inválida.' };
        }
        const ids = Array.isArray(it.customizationIds) ? [...new Set(it.customizationIds)] : [];
        const extras = [];
        for (const id of ids) {
            const extra = extrasById[id];
            if (!extra) return { ok: false, code: 'unknown_extra', error: 'Extra inexistente.' };
            // Si se conoce la relación producto-extras, el extra debe pertenecer a ese producto.
            if (allowedExtrasByMenu && !(allowedExtrasByMenu[it.menuId] && allowedExtrasByMenu[it.menuId].has(id))) {
                return { ok: false, code: 'extra_not_allowed', error: 'Ese extra no corresponde al producto.' };
            }
            extras.push({ id: extra.$id, name: extra.name, price: Number(extra.price), type: extra.type });
        }
        const unitCents = toCents(menu.price) + extras.reduce((s, e) => s + toCents(e.price), 0);
        subtotalCents += unitCents * qty;
        lines.push({
            menuId: menu.$id,
            name: menu.name,
            price: unitCents / 100,
            quantity: qty,
            customizations: JSON.stringify(extras)
        });
    }
    const feeCents = toCents(deliveryFee);
    const discountCents = Math.min(toCents(discount), subtotalCents + feeCents);
    return {
        ok: true,
        lines,
        subtotal: subtotalCents / 100,
        deliveryFee: feeCents / 100,
        discount: discountCents / 100,
        total: (subtotalCents + feeCents - discountCents) / 100
    };
}

/** Valida una posicion de repartidor: rango, no (0,0) y que no sea "vieja". */
function validateDriverPosition({ latitude, longitude, now = Date.now(), lastUpdateMs = null, minIntervalMs = 2000 }) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
        return { ok: false, code: 'bad_coordinates', error: 'Coordenadas inválidas.' };
    }
    if (lastUpdateMs !== null && now - lastUpdateMs < minIntervalMs) {
        return { ok: false, code: 'rate_limited', error: 'Actualizaciones demasiado frecuentes.' };
    }
    return { ok: true, latitude: lat, longitude: lng };
}

/** Valida la direccion de entrega recibida del cliente. */
function validateAddressInput(address) {
    const line = typeof (address && address.line) === 'string' ? address.line.trim().replace(/\s+/g, ' ') : '';
    if (line.length < 8 || line.length > 200 || !/\p{L}/u.test(line)) {
        return { ok: false, code: 'bad_address', error: 'Dirección inválida.' };
    }
    const label = address.label === 'home' || address.label === 'work' ? address.label : 'manual';
    const hasLat = address.latitude !== null && address.latitude !== undefined;
    const hasLng = address.longitude !== null && address.longitude !== undefined;
    if (hasLat !== hasLng) return { ok: false, code: 'bad_coordinates', error: 'Coordenadas incompletas.' };
    let latitude = null;
    let longitude = null;
    if (hasLat) {
        const check = validateDriverPosition({ latitude: address.latitude, longitude: address.longitude });
        if (!check.ok) return check;
        latitude = check.latitude;
        longitude = check.longitude;
    }
    return { ok: true, line, label, latitude, longitude };
}

/** Distancia en km (haversine) entre dos puntos {latitude, longitude}. */
function distanceKm(a, b) {
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.latitude - a.latitude);
    const dLng = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cobertura de entrega (opcional): se activa solo si el servidor tiene configurados el punto del
 * restaurante y un radio. Sin configuracion no se restringe nada. Con cobertura activa, una direccion
 * sin coordenadas no se puede verificar y se rechaza (el cliente debe elegirla en el mapa).
 */
function checkCoverage({ restaurantLat, restaurantLng, radiusKm, address }) {
    const lat = Number(restaurantLat);
    const lng = Number(restaurantLng);
    const radius = Number(radiusKm);
    const configured = restaurantLat !== undefined && restaurantLat !== '' && restaurantLng !== undefined && restaurantLng !== '' &&
        Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius) && radius > 0;
    if (!configured) return { ok: true, checked: false };
    if (!address || address.latitude === null || address.longitude === null || address.latitude === undefined) {
        return { ok: false, code: 'coverage_unverified', error: 'Elige la dirección en el mapa para confirmar que llegamos a tu zona.' };
    }
    const km = distanceKm({ latitude: lat, longitude: lng }, { latitude: address.latitude, longitude: address.longitude });
    return km <= radius
        ? { ok: true, checked: true, distanceKm: Math.round(km * 10) / 10 }
        : { ok: false, code: 'out_of_coverage', error: `Tu dirección queda fuera de la zona de entrega (${radius} km).` };
}

function validatePhone(raw) {
    const phone = String(raw == null ? '' : raw).replace(/[\s().-]/g, '');
    const digits = phone.replace(/\D/g, '');
    if (!/^\+?\d+$/.test(phone) || digits.length < 10 || digits.length > 15) {
        return { ok: false, code: 'bad_phone', error: 'Teléfono inválido.' };
    }
    return { ok: true, phone };
}

const ACTIVE_DELIVERY = ['preparing', 'on_the_way'];
const ASSIGNABLE = ['pending', 'confirmed', 'preparing', 'on_the_way'];
const TERMINAL = ['delivered', 'cancelled'];

/** Un pedido solo puede (re)asignarse a un repartidor mientras no sea final. */
function canAssignDriver(status) {
    return ASSIGNABLE.includes(status);
}

/** Datos del pedido que ve el personal: sin importes internos ni IDs de cuenta. */
function toStaffOrderView(order, items = []) {
    return {
        id: order.$id,
        status: order.status,
        total: order.total,
        createdAt: order.$createdAt,
        updatedAt: order.$updatedAt || null,
        customerName: order.customerName || '',
        customerPhone: order.customerPhone || '',
        deliveryAddress: order.deliveryAddress || '',
        deliveryLatitude: typeof order.deliveryLatitude === 'number' ? order.deliveryLatitude : null,
        deliveryLongitude: typeof order.deliveryLongitude === 'number' ? order.deliveryLongitude : null,
        paymentMethod: order.paymentMethod || 'cash_on_delivery',
        paymentStatus: order.paymentStatus || null,
        driverUserId: order.driverUserId || null,
        driverName: order.driverName || null,
        items: items.map((i) => ({ name: i.name, quantity: i.quantity }))
    };
}

/**
 * Control de concurrencia optimista: el cliente envia lo que vio (estado y/o
 * fecha de actualizacion). Si el pedido cambio, se rechaza. Appwrite no ofrece
 * escritura condicional, asi que queda una ventana minima entre la lectura y la
 * escritura (documentado); esto evita el caso comun de dos empleados con datos viejos.
 */
function checkExpected(order, { expectedStatus, expectedUpdatedAt } = {}) {
    if (expectedStatus !== undefined && expectedStatus !== null && order.status !== expectedStatus) {
        return { ok: false, code: 'stale_order', error: 'El pedido cambió mientras lo veías. Actualiza la lista.' };
    }
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null && order.$updatedAt !== expectedUpdatedAt) {
        return { ok: false, code: 'stale_order', error: 'El pedido cambió mientras lo veías. Actualiza la lista.' };
    }
    return { ok: true };
}

/** Valida un rango de fechas ISO opcional para filtrar pedidos. */
function parseDateRange({ from, to } = {}) {
    const out = {};
    for (const [key, value] of [['from', from], ['to', to]]) {
        if (value === undefined || value === null || value === '') continue;
        const t = typeof value === 'string' ? Date.parse(value) : NaN;
        if (Number.isNaN(t)) return { ok: false, code: 'bad_date', error: 'Fecha inválida.' };
        out[key] = new Date(t).toISOString();
    }
    if (out.from && out.to && out.from > out.to) return { ok: false, code: 'bad_date', error: 'El rango de fechas es inválido.' };
    return { ok: true, ...out };
}

/** Busqueda por identificador: completo o por los ultimos caracteres (minimo 4). */
function matchesOrderQuery(orderId, query) {
    const q = String(query == null ? '' : query).trim().replace(/^#/, '').toLowerCase();
    if (q.length < 4) return false;
    return String(orderId).toLowerCase().endsWith(q) || String(orderId).toLowerCase() === q;
}

/** Evento de historial (auditoria) de un pedido. */
function buildOrderEvent({ orderId, type, from = null, to = null, actorId, actorRole, driverUserId = null }) {
    return {
        orderId,
        type,
        fromStatus: from,
        toStatus: to,
        actorId,
        actorRole,
        driverUserId
    };
}

/** El producto puede venderse salvo que tenga `available === false` explicito. */
function isMenuAvailable(menuRow) {
    return !(menuRow && menuRow.available === false);
}

const PAYMENT_METHODS = ['cash_on_delivery', 'online'];

/** Metodo de pago permitido; cualquier otro valor se rechaza. */
function validatePaymentMethod(value) {
    if (value === undefined || value === null) return { ok: true, method: 'cash_on_delivery' };
    if (typeof value !== 'string' || !PAYMENT_METHODS.includes(value)) {
        return { ok: false, code: 'bad_payment_method', error: 'Método de pago inválido.' };
    }
    return { ok: true, method: value };
}

// ======================================================
// PAGOS CON STRIPE (Checkout alojado). El cliente nunca decide el importe ni
// si un pedido esta pagado: todo se calcula y se verifica en el servidor.
// ======================================================

const CURRENCY = 'mxn';
const PAYMENT_STATUSES = ['not_required', 'pending', 'paid', 'failed', 'cancelled', 'refunded'];

/**
 * Maquina de estados del pago. Repetir el mismo estado es un "no-op" (idempotencia:
 * un webhook recibido varias veces no cambia nada ni vuelve a notificar).
 * `paid` solo puede pasar a `refunded`; nunca vuelve atras.
 */
const PAYMENT_TRANSITIONS = {
    not_required: [],
    pending: ['paid', 'failed', 'cancelled'],
    failed: ['paid', 'cancelled'],
    paid: ['refunded'],
    cancelled: ['refunded'], // pago tardio sobre un pedido ya cancelado: se reembolsa solo
    refunded: []
};

function movePaymentStatus(from, to) {
    const current = PAYMENT_STATUSES.includes(from) ? from : 'pending';
    if (!PAYMENT_STATUSES.includes(to)) return { ok: false, code: 'bad_payment_status', error: 'Estado de pago inválido.' };
    if (current === to) return { ok: true, changed: false, status: current };
    if (!PAYMENT_TRANSITIONS[current].includes(to)) {
        return { ok: false, code: 'payment_transition', error: `El pago no puede pasar de ${current} a ${to}.` };
    }
    return { ok: true, changed: true, status: to };
}

/** Parametros de la sesion de Stripe Checkout (pares clave/valor; el importe viene del servidor). */
function buildCheckoutSessionParams({ orderId, userId, total, returnUrl, now = Date.now(), currency = CURRENCY }) {
    const sep = String(returnUrl).includes('?') ? '&' : '?';
    const enc = encodeURIComponent(orderId);
    return [
        ['mode', 'payment'],
        ['client_reference_id', orderId],
        ['success_url', `${returnUrl}${sep}result=success&order=${enc}`],
        ['cancel_url', `${returnUrl}${sep}result=cancelled&order=${enc}`],
        ['payment_method_types[0]', 'card'],
        ['line_items[0][quantity]', '1'],
        ['line_items[0][price_data][currency]', currency],
        ['line_items[0][price_data][unit_amount]', String(toCents(total))],
        ['line_items[0][price_data][product_data][name]', `Pedido Delivery #${String(orderId).slice(-6)}`],
        ['metadata[orderId]', orderId],
        ['metadata[userId]', userId],
        ['payment_intent_data[metadata][orderId]', orderId],
        ['payment_intent_data[metadata][userId]', userId],
        // Stripe exige entre 30 min y 24 h; despues la sesion expira y el pedido puede reintentarse.
        ['expires_at', String(Math.floor(now / 1000) + 31 * 60)]
    ];
}

const formEncode = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

/**
 * Evalua una sesion de Stripe contra el pedido guardado en el servidor.
 * Solo es `paid` si Stripe confirma el cobro, el importe y la moneda son EXACTOS y la
 * sesion pertenece a ese pedido (evita pagar de menos o usar la sesion de otro pedido).
 */
function checkSessionPayment(session, { orderId, total, currency = CURRENCY }) {
    if (!session || typeof session !== 'object') return { state: 'unknown', reason: 'no_session' };
    const belongs = session.client_reference_id === orderId && (!session.metadata || session.metadata.orderId === orderId);
    if (!belongs) return { state: 'invalid', reason: 'wrong_order' };
    if (session.status === 'expired') return { state: 'expired', reason: 'expired' };
    if (session.payment_status === 'paid' && session.status === 'complete') {
        if (String(session.currency || '').toLowerCase() !== currency) return { state: 'invalid', reason: 'currency_mismatch' };
        if (session.amount_total !== toCents(total)) return { state: 'invalid', reason: 'amount_mismatch' };
        return { state: 'paid', reason: 'ok' };
    }
    return { state: 'unpaid', reason: session.payment_status || 'unpaid' };
}

/** Id del PaymentIntent de una sesion (puede venir como texto o expandido). */
function paymentIntentId(session) {
    const pi = session && session.payment_intent;
    return typeof pi === 'string' ? pi : pi && typeof pi === 'object' && typeof pi.id === 'string' ? pi.id : null;
}

/** Cabecera `Stripe-Signature`: "t=...,v1=...,v1=...". Devuelve null si no es valida. */
function parseStripeSignatureHeader(header) {
    if (typeof header !== 'string' || header.length > 2000) return null;
    let timestamp = null;
    const signatures = [];
    for (const part of header.split(',')) {
        const i = part.indexOf('=');
        if (i < 1) continue;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k === 't' && /^\d{1,12}$/.test(v)) timestamp = Number(v);
        else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
    }
    return timestamp !== null && signatures.length > 0 ? { timestamp, signatures } : null;
}

/** El evento firmado solo vale si es reciente (proteccion contra repeticion). */
function isFreshTimestamp(timestamp, nowMs = Date.now(), toleranceSec = 300) {
    return Number.isFinite(timestamp) && Math.abs(Math.floor(nowMs / 1000) - timestamp) <= toleranceSec;
}

/** Cadena que Stripe firma con HMAC-SHA256: "<timestamp>.<cuerpo crudo>". */
const signedPayload = (timestamp, rawBody) => `${timestamp}.${rawBody}`;

/**
 * Traduce un evento de Stripe a un cambio de pago. Devuelve null para eventos ignorados.
 * `kind`: paid | failed | expired | refunded.
 */
function stripeEventToPayment(event) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return null;
    const obj = event.data && event.data.object;
    if (!obj || typeof obj !== 'object') return null;
    switch (event.type) {
        case 'checkout.session.completed':
            // Con pago diferido llega "unpaid": se espera async_payment_succeeded.
            return obj.payment_status === 'paid' ? { kind: 'paid', orderId: obj.client_reference_id, session: obj } : null;
        case 'checkout.session.async_payment_succeeded':
            return { kind: 'paid', orderId: obj.client_reference_id, session: obj };
        case 'checkout.session.async_payment_failed':
            return { kind: 'failed', orderId: obj.client_reference_id, session: obj };
        case 'checkout.session.expired':
            return { kind: 'expired', orderId: obj.client_reference_id, session: obj };
        case 'charge.refunded': {
            // Solo un reembolso total cambia el estado del pago a `refunded`.
            const full = obj.refunded === true || (typeof obj.amount === 'number' && obj.amount_refunded === obj.amount);
            const orderId = obj.metadata && obj.metadata.orderId;
            return full && typeof orderId === 'string' ? { kind: 'refunded', orderId, charge: obj } : null;
        }
        default:
            return null;
    }
}

/**
 * Llamada a la API de Stripe (form-urlencoded). La clave secreta solo existe en el servidor.
 * `idempotencyKey` evita cobros/reembolsos duplicados si la llamada se repite.
 */
async function stripeRequest({ secret, method = 'POST', path, params = [], idempotencyKey, fetchImpl = fetch, timeoutMs = 10000 }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const headers = { Authorization: `Bearer ${secret}` };
        const init = { method, headers, signal: ctrl.signal };
        let url = `https://api.stripe.com${path}`;
        if (method === 'GET') {
            if (params.length) url += `?${formEncode(params)}`;
        } else {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
            init.body = formEncode(params);
        }
        const res = await fetchImpl(url, init);
        const data = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, data };
    } catch {
        return { ok: false, status: 0, data: null };
    } finally {
        clearTimeout(timer);
    }
}

/** Enlaces de pago que la app acepta abrir (los mismos que valida el cliente). */
const isStripeCheckoutUrl = (url) => {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com';
    } catch {
        return false;
    }
};

// ======================================================
// NOTIFICACIONES PUSH (Appwrite Messaging + FCM). El servidor decide a quien se avisa.
// Los valores de `data` van como texto porque FCM no acepta otros tipos.
// ======================================================

const STATUS_MESSAGES = {
    confirmed: ['Pedido confirmado', 'El restaurante confirmó tu pedido.'],
    preparing: ['Preparando tu pedido', 'Estamos preparando tus alimentos.'],
    on_the_way: ['¡Tu pedido va en camino!', 'Puedes seguir al repartidor en el mapa.'],
    delivered: ['Pedido entregado', 'Buen provecho.'],
    cancelled: ['Pedido cancelado', 'Tu pedido fue cancelado.']
};

/** Mensaje al cliente por cambio de estado. Sin direccion ni telefono. */
function buildStatusNotification(status, orderId) {
    const m = STATUS_MESSAGES[status];
    if (!m) return null;
    return { title: m[0], body: m[1], data: { type: 'order_status', orderId, status } };
}

/** "Pedido recibido": al crearlo (efectivo) o al confirmarse el pago (en linea). */
function buildOrderReceivedNotification(orderId) {
    return { title: 'Pedido recibido', body: `Recibimos tu pedido #${String(orderId).slice(-6)}.`, data: { type: 'order_status', orderId, status: 'pending' } };
}

function buildAssignmentNotification(orderId) {
    return { title: 'Nueva entrega asignada', body: `Tienes el pedido #${String(orderId).slice(-6)} por entregar.`, data: { type: 'driver_assigned', orderId } };
}

const PAYMENT_MESSAGES = {
    paid: ['Pago recibido', 'Confirmamos tu pago. Tu pedido sigue su curso.'],
    refunded: ['Reembolso emitido', 'Te devolvimos el importe de tu pedido cancelado.'],
    failed: ['Pago no completado', 'Tu pago no se pudo completar. Puedes reintentarlo desde Mis pedidos.']
};

function buildPaymentNotification(kind, orderId) {
    const m = PAYMENT_MESSAGES[kind];
    if (!m) return null;
    return { title: m[0], body: m[1], data: { type: 'order_status', orderId, payment: kind } };
}

/**
 * Parametros de `messaging.createPush`. Solo se envia al usuario indicado por el servidor;
 * nunca a destinatarios elegidos por el cliente. Devuelve null si falta algo.
 */
function buildPushRequest(accountId, message) {
    if (typeof accountId !== 'string' || !accountId || !message || !message.title) return null;
    const data = {};
    for (const [k, v] of Object.entries(message.data || {})) if (v !== undefined && v !== null) data[k] = String(v);
    return { title: String(message.title).slice(0, 100), body: String(message.body || '').slice(0, 250), users: [accountId], data };
}

module.exports = {
    TRANSITIONS, ACTIVE_DELIVERY, ASSIGNABLE, TERMINAL,
    canActorTransition, priceOrder, validateDriverPosition,
    validateAddressInput, validatePhone, distanceKm, checkCoverage, canAssignDriver, toStaffOrderView,
    checkExpected, parseDateRange, matchesOrderQuery, buildOrderEvent, isMenuAvailable,
    PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TRANSITIONS, CURRENCY, validatePaymentMethod, movePaymentStatus,
    buildCheckoutSessionParams, formEncode, checkSessionPayment, paymentIntentId,
    parseStripeSignatureHeader, isFreshTimestamp, signedPayload, stripeEventToPayment, stripeRequest, isStripeCheckoutUrl,
    buildStatusNotification, buildOrderReceivedNotification, buildAssignmentNotification, buildPaymentNotification, buildPushRequest
};
