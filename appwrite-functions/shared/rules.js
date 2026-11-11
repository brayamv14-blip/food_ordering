'use strict';
/**
 * Reglas de negocio ejecutadas en el servidor (Appwrite Functions, Node 18+).
 * Es JavaScript puro, sin dependencias, para poder probarlo con Jest y copiarlo
 * dentro de cada funcion al desplegar (ver appwrite-functions/README.md).
 */

const TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    // `ready` (listo para recoger) es opcional: se puede pasar de preparing a on_the_way directamente.
    // Flujo del repartidor: ready (listo en cocina) -> picked_up (el repartidor ya tiene el pedido) -> on_the_way
    // (salio hacia el cliente). Ambos pasos intermedios son opcionales; "recogido" y "en camino" son estados distintos.
    preparing: ['ready', 'picked_up', 'on_the_way'],
    ready: ['picked_up', 'on_the_way'],
    // Desde "recogido" tambien se puede reportar fallo (cliente ilocalizable antes de salir): no hay callejon sin salida.
    picked_up: ['on_the_way', 'delivery_failed'],
    on_the_way: ['delivered', 'delivery_failed'],
    // Entrega fallida: el personal decide reintentar (on_the_way) o cancelar (con reembolso si estaba pagado).
    delivery_failed: ['on_the_way', 'cancelled'],
    delivered: [],
    cancelled: []
};

/** Que rol puede pedir cada transicion. El cliente solo cancela pedidos pendientes. */
function canActorTransition({ actor, isOwner, from, to, hasDriver = true, driverAccepted = true, payment = null }) {
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
    if ((to === 'on_the_way' || to === 'picked_up') && !hasDriver) {
        return { ok: false, code: 'driver_required', error: 'Asigna un repartidor antes de enviar el pedido.' };
    }
    // El repartidor debe haber aceptado la asignacion (los pedidos asignados antes de v8 cuentan como aceptados).
    if ((to === 'on_the_way' || to === 'picked_up') && hasDriver && driverAccepted === false) {
        return { ok: false, code: 'assignment_pending', error: 'El repartidor todavía no acepta la asignación.' };
    }
    if (actor === 'staff') return { ok: true };
    if (actor === 'driver') {
        const ok = ((from === 'preparing' || from === 'ready') && (to === 'picked_up' || to === 'on_the_way')) ||
            (from === 'picked_up' && (to === 'on_the_way' || to === 'delivery_failed')) || (from === 'delivery_failed' && to === 'on_the_way') ||
            (from === 'on_the_way' && (to === 'delivered' || to === 'delivery_failed'));
        if (ok) return { ok: true };
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

/** Maximo de pedidos en linea sin pagar por usuario (evita abusar de sesiones de Stripe). */
const MAX_OPEN_UNPAID = 5;

/** Cuenta los pedidos en linea pendientes de pago entre las filas recientes del usuario. */
function countOpenUnpaid(rows) {
    return (Array.isArray(rows) ? rows : []).filter(
        (o) => o && o.paymentMethod === 'online' && o.status === 'pending' && (o.paymentStatus || 'pending') === 'pending'
    ).length;
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

const ACTIVE_DELIVERY = ['preparing', 'ready', 'picked_up', 'on_the_way', 'delivery_failed'];
const ASSIGNABLE = ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivery_failed'];
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
        driverResponse: order.driverUserId ? (order.driverResponse || 'accepted') : null,
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
    // pending/failed -> refunded: un charge.refunded que llega ANTES que el "pagado" (eventos fuera de orden) debe
    // dejar el pedido reembolsado; el "pagado" tardio ya no puede revertirlo (refunded no sale).
    pending: ['paid', 'failed', 'cancelled', 'refunded'],
    failed: ['paid', 'cancelled', 'refunded'],
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
    picked_up: ['Tu pedido fue recogido', 'El repartidor ya tiene tu pedido.'],
    ready: ['Tu pedido está listo', 'Ya está listo para que el repartidor lo recoja.'],
    delivery_failed: ['No pudimos entregar tu pedido', 'El restaurante se pondrá en contacto contigo.'],
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

// ====================================================================
// Inventario, administracion y reportes (v8)
// ====================================================================

const ROLE_LABELS = ['admin', 'staff', 'driver'];
const DEFAULT_LOW_STOCK = 5;

/** Existencias de un producto: entero >= 0 si se controlan; null si el producto no controla inventario. */
function stockOf(menuRow) {
    const s = menuRow && menuRow.stock;
    if (typeof s !== 'number' || !Number.isInteger(s)) return null;
    // Un valor negativo es un estado inconsistente: se trata como agotado, NUNCA como "sin control" (ventas ilimitadas).
    return s < 0 ? 0 : s;
}

/** Suma cantidades por producto (el mismo producto puede aparecer en varias lineas con extras distintos). */
function totalsByMenu(lines) {
    const out = {};
    for (const l of lines || []) out[l.menuId] = (out[l.menuId] || 0) + Number(l.quantity || 0);
    return out;
}

/** Comprueba existencias contra lo leido del servidor. Productos sin control de stock siempre alcanzan. */
function checkStock(lines, menuById) {
    const totals = totalsByMenu(lines);
    for (const [menuId, qty] of Object.entries(totals)) {
        const menu = menuById[menuId];
        const stock = stockOf(menu);
        if (stock !== null && stock < qty) {
            return { ok: false, code: 'insufficient_stock', error: `No hay suficientes existencias de “${menu.name}” (quedan ${stock}).`, menuId, available: stock };
        }
    }
    return { ok: true, totals };
}

/** Clave unica (idempotencia) de un movimiento de inventario: `r` reserva, `x` devolucion. */
const moveKey = (kind, orderId, menuId) => `${kind === 'reserve' ? 'r' : 'x'}:${orderId}:${menuId}`;

const isLowStock = (stock, threshold = DEFAULT_LOW_STOCK) => typeof stock === 'number' && stock <= threshold;

/** Campos de producto que el administrador puede escribir (lista blanca; nada mas se acepta). */
function validateProductInput(input, { partial = false } = {}) {
    if (!input || typeof input !== 'object') return { ok: false, code: 'bad_request', error: 'Datos del producto inválidos.' };
    const out = {};
    const bad = (field, error) => ({ ok: false, code: 'bad_product', error, field });
    const has = (k) => input[k] !== undefined;
    if (!partial || has('name')) {
        const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
        if (name.length < 2 || name.length > 80) return bad('name', 'El nombre debe tener entre 2 y 80 caracteres.');
        out.name = name;
    }
    if (!partial || has('price')) {
        const price = Number(input.price);
        if (!Number.isFinite(price) || price <= 0 || price > 100000 || Math.round(price * 100) !== price * 100 && Math.abs(Math.round(price * 100) - price * 100) > 1e-6) {
            return bad('price', 'El precio debe ser mayor que 0 y tener máximo 2 decimales.');
        }
        out.price = Math.round(price * 100) / 100;
    }
    if (has('description')) {
        if (typeof input.description !== 'string' || input.description.length > 500) return bad('description', 'La descripción es muy larga (máximo 500).');
        out.description = input.description.trim();
    }
    if (has('image_url')) {
        const url = input.image_url;
        if (typeof url !== 'string' || url.length > 500 || !/^https:\/\/[^\s]+$/i.test(url)) return bad('image_url', 'La imagen debe ser un enlace https.');
        out.image_url = url;
    }
    for (const f of ['calories', 'protein']) {
        if (has(f)) {
            const n = Number(input[f]);
            if (!Number.isFinite(n) || n < 0 || n > 100000) return bad(f, `${f} inválido.`);
            out[f] = n;
        }
    }
    if (has('rating')) {
        const n = Number(input.rating);
        if (!Number.isFinite(n) || n < 0 || n > 5) return bad('rating', 'La calificación va de 0 a 5.');
        out.rating = n;
    }
    if (has('type')) {
        if (typeof input.type !== 'string' || input.type.length > 40) return bad('type', 'Tipo inválido.');
        out.type = input.type.trim();
    }
    if (has('categories')) {
        if (typeof input.categories !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.categories)) return bad('categories', 'Categoría inválida.');
        out.categories = input.categories;
    }
    if (has('available')) {
        if (typeof input.available !== 'boolean') return bad('available', 'Disponibilidad inválida.');
        out.available = input.available;
    }
    if (has('stock')) {
        // null/"" => dejar de controlar inventario
        if (input.stock === null || input.stock === '') out.stock = null;
        else {
            const n = Number(input.stock);
            if (!Number.isInteger(n) || n < 0 || n > 1000000) return bad('stock', 'Las existencias deben ser un entero entre 0 y 1,000,000.');
            out.stock = n;
        }
    }
    return { ok: true, data: out };
}

/** Ajuste manual de existencias: o un nuevo total (`set`) o una variacion (`delta`), nunca bajo 0. */
function planStockAdjust(current, { set, delta }) {
    const cur = typeof current === 'number' ? current : 0;
    let next;
    if (set !== undefined) next = Number(set);
    else if (delta !== undefined) next = cur + Number(delta);
    else return { ok: false, code: 'bad_request', error: 'Indica "set" o "delta".' };
    if (!Number.isInteger(next) || next < 0 || next > 1000000) return { ok: false, code: 'bad_stock', error: 'Existencias inválidas (entero entre 0 y 1,000,000).' };
    return { ok: true, next, delta: next - cur };
}

/** Cambio de roles: solo etiquetas conocidas; el administrador no puede quitarse su propio acceso. */
function validateRoleChange({ actorId, targetId, labels, targetCurrent = [] }) {
    if (!Array.isArray(labels) || labels.some((l) => !ROLE_LABELS.includes(l)) || new Set(labels).size !== labels.length) {
        return { ok: false, code: 'bad_roles', error: 'Roles inválidos.' };
    }
    if (actorId === targetId && targetCurrent.includes('admin') && !labels.includes('admin')) {
        return { ok: false, code: 'self_demote', error: 'No puedes quitarte a ti mismo el rol de administrador.' };
    }
    // Se conservan etiquetas ajenas a la app (otras que el proyecto use) sin tocarlas.
    const foreign = targetCurrent.filter((l) => !ROLE_LABELS.includes(l));
    return { ok: true, labels: [...labels, ...foreign] };
}

const cents = (n) => Math.round((Number(n) + Number.EPSILON) * 100);

/**
 * Indicadores a partir de pedidos reales. "Ventas" = pedidos entregados; los pagos en linea
 * reembolsados o cancelados no cuentan. Nada se estima: solo se suma lo recibido.
 */
function aggregateReport(orders, itemsByOrder = {}) {
    const byStatus = {};
    let salesCents = 0, delivered = 0, cancelled = 0, refundedCents = 0;
    const products = {};
    const perDay = {};
    for (const o of orders || []) {
        if (!o) continue;
        byStatus[o.status] = (byStatus[o.status] || 0) + 1;
        if (o.status === 'delivered') {
            delivered++;
            salesCents += cents(o.total);
            const day = String(o.$createdAt || '').slice(0, 10);
            if (day) perDay[day] = (perDay[day] || 0) + cents(o.total);
            for (const it of itemsByOrder[o.$id] || []) {
                const k = it.menuId || it.name;
                const p = (products[k] ||= { menuId: it.menuId || null, name: it.name, quantity: 0, salesCents: 0 });
                p.quantity += Number(it.quantity || 0);
                p.salesCents += cents(it.price) * Number(it.quantity || 0);
            }
        }
        if (o.status === 'cancelled') cancelled++;
        if (o.paymentStatus === 'refunded') refundedCents += cents(o.total);
    }
    const total = (orders || []).length;
    const top = Object.values(products).sort((a, b) => b.quantity - a.quantity || b.salesCents - a.salesCents).slice(0, 10)
        .map((p) => ({ menuId: p.menuId, name: p.name, quantity: p.quantity, sales: p.salesCents / 100 }));
    return {
        orders: total, delivered, cancelled, byStatus,
        sales: salesCents / 100,
        averageTicket: delivered ? Math.round(salesCents / delivered) / 100 : 0,
        cancellationRate: total ? Math.round((cancelled / total) * 1000) / 10 : 0,
        refunded: refundedCents / 100,
        topProducts: top,
        salesByDay: Object.keys(perDay).sort().map((d) => ({ day: d, sales: perDay[d] / 100 }))
    };
}

/** CSV seguro: comillas dobles escapadas y proteccion contra formulas (=,+,-,@) al abrirlo en una hoja de calculo. */
function toCsv(rows, columns) {
    const esc = (v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [columns.join(','), ...(rows || []).map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

/** Elige el repartidor para asignacion automatica: disponible, sin exceso de entregas y con menos carga. */
function pickDriver(candidates, { maxActive = 3 } = {}) {
    const ok = (candidates || []).filter((d) => d && d.available === true && d.active < maxActive);
    ok.sort((a, b) => a.active - b.active || String(a.id).localeCompare(String(b.id)));
    return ok[0] || null;
}

// ---- Notificaciones v8
function buildLowStockNotification(name, stock) {
    return { title: 'Existencias bajas', body: `Quedan ${stock} de “${String(name).slice(0, 60)}”.`, data: { type: 'low_stock' } };
}
function buildDriverRejectedNotification(orderId, driverName) {
    return { title: 'Repartidor rechazó el pedido', body: `${String(driverName || 'El repartidor').slice(0, 40)} rechazó el pedido #${String(orderId).slice(-6)}. Asigna otro.`, data: { type: 'driver_rejected', orderId } };
}

/**
 * Inventario con inyeccion de dependencias (la misma logica corre en las Functions y en las pruebas).
 *
 * Reglas de negocio:
 *  - RESERVA al crear el pedido (efectivo o en linea): el stock se descuenta de inmediato para que dos clientes
 *    no compren la ultima unidad. Un pedido en linea sin pagar mantiene la reserva hasta que se paga o vence/cancela.
 *  - LIBERACION (devuelve el stock) cuando el pedido se cancela (incluye reembolso, que siempre implica cancelar)
 *    o cuando la sesion de pago vence sin cobro. Entregar o fallar la entrega NO devuelve stock.
 *  - Idempotencia: cada movimiento usa un rowId determinista (hash de "r|x:pedido:producto"). Appwrite rechaza
 *    un rowId repetido con 409, por lo que reservar o liberar dos veces el mismo pedido es imposible.
 *  - Atomicidad: se usa decrementRowColumn/incrementRowColumn del servidor (operacion atomica con minimo 0),
 *    no leer-modificar-escribir, asi que las compras simultaneas no pueden dejar el stock negativo.
 */
function makeInventory({ db, DB, MENU, MOVES, Query, hash }) {
    const rowIdFor = (kind, orderId, menuId) => 'm' + hash(moveKey(kind, orderId, menuId)).slice(0, 32);
    const isConflict = (e) => e && (e.code === 409 || /already exists|409/i.test(String(e.message || '')));
    const enabled = !!MOVES;

    /**
     * Descuento atomico del servidor. NO se usa el parametro `min`: la documentacion de Appwrite no dice si un
     * limite violado rechaza la operacion o la recorta, y recortar vendería unidades que no existen. En su lugar se
     * lee el valor resultante que devuelve la propia operacion: si es negativo hubo sobreventa y se compensa al
     * instante. Si la columna tiene minimo 0 y el servidor rechaza (400/409), tambien cuenta como sin existencias.
     * Errores de red o 5xx se propagan (nunca se interpretan como "sin stock").
     */
    async function decrement(menuId, qty) {
        let row;
        try {
            row = await db.decrementRowColumn({ databaseId: DB, tableId: MENU, rowId: menuId, column: 'stock', value: qty });
        } catch (e) {
            if (e && (e.code === 400 || e.code === 409)) return { ok: false, reason: 'rejected' };
            throw e;
        }
        let after = row && typeof row.stock === 'number' ? row.stock : null;
        if (after === null) {
            // Respaldo si el SDK no devuelve la fila: lectura posterior (ya no es atomica; solo para no ignorar la sobreventa).
            const fresh = await db.getRow({ databaseId: DB, tableId: MENU, rowId: menuId });
            if (typeof fresh.stock !== 'number') throw new Error('stock_unreadable');
            after = fresh.stock;
        }
        if (after < 0) {
            await db.incrementRowColumn({ databaseId: DB, tableId: MENU, rowId: menuId, column: 'stock', value: qty });
            return { ok: false, reason: 'oversold' };
        }
        return { ok: true, after };
    }

    async function increment(menuId, qty) {
        const row = await db.incrementRowColumn({ databaseId: DB, tableId: MENU, rowId: menuId, column: 'stock', value: qty });
        return row && typeof row.stock === 'number' ? row.stock : null;
    }

    async function release(orderId, reason = 'order_cancelled') {
        if (!enabled) return { released: [] };
        const reserved = (await db.listRows({ databaseId: DB, tableId: MOVES, queries: [Query.equal('orderId', orderId), Query.equal('type', ['reserve']), Query.limit(100)] })).rows;
        const released = [];
        for (const m of reserved) {
            const rowId = rowIdFor('release', orderId, m.menuId);
            try {
                // Primero se registra la devolucion (clave unica): si ya existe, otro intento ya la hizo.
                await db.createRow({ databaseId: DB, tableId: MOVES, rowId, data: { orderId, menuId: m.menuId, type: 'release', quantity: m.quantity, delta: m.quantity, reason } });
            } catch (e) {
                if (isConflict(e)) continue;
                throw e;
            }
            try {
                await increment(m.menuId, m.quantity);
                released.push(m.menuId);
            } catch (e) {
                // Sin devolver el stock no se deja constancia: el siguiente intento (o la reconciliacion) lo reintenta.
                await db.deleteRow({ databaseId: DB, tableId: MOVES, rowId }).catch(() => {});
                throw e;
            }
        }
        return { released };
    }

    /**
     * Reserva todas las lineas o ninguna. Si algo falla a mitad, se devuelve lo ya descontado con `release`
     * (que deja la huella necesaria); si incluso eso falla, la reserva queda registrada SIN devolucion y la
     * reconciliacion de administracion la encuentra (reserva cuyo pedido no existe o esta cancelado).
     */
    async function reserve({ orderId, totals, menuById }) {
        if (!enabled) return { ok: true, reserved: [], low: [] };
        const reserved = [];
        const low = [];
        const rollback = async () => {
            try {
                await release(orderId, 'reserve_rollback');
            } catch {
                /* queda para la reconciliacion */
            }
        };
        for (const [menuId, qty] of Object.entries(totals)) {
            const menu = menuById[menuId];
            if (stockOf(menu) === null) continue; // producto sin control de inventario
            const rowId = rowIdFor('reserve', orderId, menuId);
            const prior = await db.getRow({ databaseId: DB, tableId: MOVES, rowId }).catch(() => null);
            if (prior) { reserved.push(menuId); continue; } // reintento: ya reservado
            let dec;
            try {
                dec = await decrement(menuId, qty);
            } catch (e) {
                await rollback();
                throw e;
            }
            if (!dec.ok) {
                await rollback();
                return { ok: false, code: 'insufficient_stock', error: `No hay suficientes existencias de “${menu.name}”.`, menuId };
            }
            try {
                await db.createRow({ databaseId: DB, tableId: MOVES, rowId, data: { orderId, menuId, type: 'reserve', quantity: qty, delta: -qty, reason: 'order_created' } });
            } catch (e) {
                // Sin constancia no se conserva el descuento.
                let leaked = false;
                try { await increment(menuId, qty); } catch { leaked = true; }
                if (isConflict(e) && !leaked) { reserved.push(menuId); continue; } // otra copia del mismo intento ya registro la reserva
                await rollback();
                throw Object.assign(new Error(`${leaked ? 'inventory_leak ' : ''}reserve_record_failed`), { leak: leaked ? { menuId, qty } : null });
            }
            reserved.push(menuId);
            const threshold = Number.isInteger(menu.lowStockThreshold) ? menu.lowStockThreshold : DEFAULT_LOW_STOCK;
            if (dec.after <= threshold && dec.after + qty > threshold) low.push({ menuId, name: menu.name, stock: dec.after });
        }
        return { ok: true, reserved, low };
    }

    return { enabled, reserve, release, decrement, increment, rowIdFor };
}

module.exports = {
    TRANSITIONS, ACTIVE_DELIVERY, ASSIGNABLE, TERMINAL,
    canActorTransition, priceOrder, validateDriverPosition,
    validateAddressInput, validatePhone, distanceKm, checkCoverage, countOpenUnpaid, MAX_OPEN_UNPAID,
    ROLE_LABELS, DEFAULT_LOW_STOCK, stockOf, totalsByMenu, checkStock, moveKey, isLowStock, validateProductInput, planStockAdjust,
    validateRoleChange, aggregateReport, toCsv, pickDriver, makeInventory, buildLowStockNotification, buildDriverRejectedNotification, canAssignDriver, toStaffOrderView,
    checkExpected, parseDateRange, matchesOrderQuery, buildOrderEvent, isMenuAvailable,
    PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TRANSITIONS, CURRENCY, validatePaymentMethod, movePaymentStatus,
    buildCheckoutSessionParams, formEncode, checkSessionPayment, paymentIntentId,
    parseStripeSignatureHeader, isFreshTimestamp, signedPayload, stripeEventToPayment, stripeRequest, isStripeCheckoutUrl,
    buildStatusNotification, buildOrderReceivedNotification, buildAssignmentNotification, buildPaymentNotification, buildPushRequest
};
