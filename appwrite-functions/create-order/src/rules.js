// ARCHIVO GENERADO por sync-shared.sh a partir de shared/rules.js. No editar a mano.
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
    // El cliente cancela solo antes de que se empiece a preparar; si ya pago en linea, el servidor reembolsa en automatico.
    if (isOwner && (from === 'pending' || from === 'confirmed') && to === 'cancelled') return { ok: true };
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

/** Anti-abuso general: maximo de pedidos nuevos por usuario en una ventana de 10 minutos. */
const MAX_ORDERS_PER_WINDOW = 8;
const ORDER_WINDOW_MS = 10 * 60 * 1000;

/** Cuenta los pedidos creados dentro de la ventana (filas con `$createdAt`). */
function countRecentOrders(rows, now = Date.now(), windowMs = ORDER_WINDOW_MS) {
    return (Array.isArray(rows) ? rows : []).filter((r) => {
        const t = Date.parse(r && r.$createdAt);
        return Number.isFinite(t) && now - t >= 0 && now - t <= windowMs;
    }).length;
}

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
        tip: Number(order.tip) > 0 ? Number(order.tip) : 0,
        couponCode: order.couponCode || null,
        rating: typeof order.rating === 'number' ? order.rating : null,
        driverRating: typeof order.driverRating === 'number' ? order.driverRating : null,
        createdAt: order.$createdAt,
        updatedAt: order.$updatedAt || null,
        customerName: order.customerName || '',
        customerPhone: order.customerPhone || '',
        deliveryAddress: order.deliveryAddress || '',
        deliveryLatitude: typeof order.deliveryLatitude === 'number' ? order.deliveryLatitude : null,
        deliveryLongitude: typeof order.deliveryLongitude === 'number' ? order.deliveryLongitude : null,
        paymentMethod: order.paymentMethod || 'cash_on_delivery',
        paymentStatus: order.paymentStatus || null,
        refundedAmount: Number(order.refundedAmount) > 0 ? Number(order.refundedAmount) : 0,
        receivedAt: order.receivedAt || null,
        driverUserId: order.driverUserId || null,
        driverName: order.driverName || null,
        driverResponse: order.driverUserId ? (order.driverResponse || 'accepted') : null,
        driverLatitude: order.driverUserId && typeof order.driverLatitude === 'number' ? order.driverLatitude : null,
        driverLongitude: order.driverUserId && typeof order.driverLongitude === 'number' ? order.driverLongitude : null,
        driverUpdatedAt: order.driverUserId ? (order.driverUpdatedAt || null) : null,
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
function buildOrderEvent({ orderId, type, from = null, to = null, actorId, actorRole, driverUserId = null, note = null }) {
    return {
        orderId,
        type,
        fromStatus: from,
        toStatus: to,
        actorId,
        actorRole,
        driverUserId,
        // Motivo/comentario (opcional): solo se envia si existe, asi un despliegue sin la columna `note` sigue funcionando.
        ...(typeof note === 'string' && note ? { note: note.slice(0, 200) } : {})
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

/**
 * Parametros de la sesion de Stripe Checkout (pares clave/valor; el importe viene del servidor).
 * NO se envia `payment_method_types`: las versiones recientes de la API de Stripe (2026-09-30 y posteriores) lo rechazan con 400.
 * Los metodos de pago se administran en Dashboard > Configuracion > Metodos de pago (dejar activadas solo las tarjetas si se quiere solo tarjeta).
 */
function buildCheckoutSessionParams({ orderId, userId, total, returnUrl, now = Date.now(), currency = CURRENCY }) {
    const sep = String(returnUrl).includes('?') ? '&' : '?';
    const enc = encodeURIComponent(orderId);
    return [
        ['mode', 'payment'],
        ['client_reference_id', orderId],
        ['success_url', `${returnUrl}${sep}result=success&order=${enc}`],
        ['cancel_url', `${returnUrl}${sep}result=cancelled&order=${enc}`],
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
            if (typeof orderId !== 'string') return null;
            if (full) return { kind: 'refunded', orderId, charge: obj };
            // Reembolso parcial (p. ej. desde el panel de Stripe): no cambia el estado del pago, solo el importe reembolsado.
            return typeof obj.amount_refunded === 'number' && obj.amount_refunded > 0 ? { kind: 'partial_refund', orderId, charge: obj } : null;
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

const ROLE_LABELS = ['superadmin', 'admin', 'staff', 'driver'];
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
    // V15: el rol de superadministrador NUNCA se concede desde la app (solo con scripts/create-superadmin.mjs, con llave de servidor).
    if (labels.includes('superadmin') && !targetCurrent.includes('superadmin')) {
        return { ok: false, code: 'role_not_allowed', error: 'El rol de superadministrador no se puede asignar desde la aplicación.' };
    }
    if (targetCurrent.includes('superadmin') && !labels.includes('superadmin')) {
        return { ok: false, code: 'role_not_allowed', error: 'No se puede quitar el rol de superadministrador desde la aplicación.' };
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
        else if (Number(o.refundedAmount) > 0) refundedCents += cents(o.refundedAmount);
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
        salesByDay: Object.keys(perDay).sort().map((d) => ({ day: d, sales: perDay[d] / 100 })),
        salesByWeek: Object.entries(groupSales(perDay, 'week')).sort().map(([day, c]) => ({ day, sales: c / 100 })),
        salesByMonth: Object.entries(groupSales(perDay, 'month')).sort().map(([day, c]) => ({ day, sales: c / 100 }))
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

// ======================================================
// v11: repartidores (estados), motivos, reembolsos parciales, categorias, auditoria, informes
// ======================================================
const DRIVER_STALE_MS = 10 * 60 * 1000; // sin senal de la app mas de 10 min => "sin conexion reciente"
const IN_TRANSIT = ['picked_up', 'on_the_way'];

/**
 * Estado de un repartidor. Se separan cuatro cosas:
 *  - desconectado (`offline`): el propio repartidor se puso no disponible;
 *  - disponible (`available`): conectado y puede recibir pedidos;
 *  - ocupado (`busy`): lleva un pedido en transito o alcanzo su maximo de entregas activas;
 *  - `connected`: ultima senal de su app reciente (informativo; no cambia el estado por si solo).
 * Sin senal reciente NO se le considera disponible para asignacion automatica (`stale`).
 */
function driverState({ available, lastSeenAt = null, active = 0, inTransit = 0, maxActive = 3, now = Date.now() } = {}) {
    const seen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
    const seenMs = Number.isNaN(seen) ? null : seen;
    const connected = seenMs !== null && now - seenMs <= DRIVER_STALE_MS;
    const stale = seenMs !== null && !connected;
    let status;
    if (available === false) status = 'offline';
    else if (inTransit > 0 || active >= maxActive) status = 'busy';
    else status = 'available';
    return { status, connected, stale, lastSeenAt: seenMs !== null ? new Date(seenMs).toISOString() : null };
}

const POOL_STATUSES = ['confirmed', 'preparing', 'ready'];

/**
 * Vista de un pedido SIN repartidor para la lista de "pedidos disponibles". Es deliberadamente pobre: sin nombre, telefono
 * ni direccion del cliente (el repartidor los ve solo cuando el pedido ya es suyo); la zona es una posicion aproximada (~1 km).
 */
function toPoolView(order, items = [], distanceFromRestaurantKm = null) {
    const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
    return {
        id: order.$id,
        status: order.status,
        createdAt: order.$createdAt,
        total: order.total,
        paymentMethod: order.paymentMethod || 'cash_on_delivery',
        itemsCount: items.reduce((a, i) => a + Number(i.quantity || 0), 0),
        areaLatitude: round2(order.deliveryLatitude),
        areaLongitude: round2(order.deliveryLongitude),
        distanceKm: typeof distanceFromRestaurantKm === 'number' ? Math.round(distanceFromRestaurantKm * 10) / 10 : null
    };
}
const buildDriverCancelledNotification = (orderId) => ({ title: 'Pedido cancelado', body: `El pedido #${String(orderId).slice(-6)} fue cancelado. Ya no tienes que entregarlo.`, data: { type: 'order_cancelled', orderId } });

/** Motivo de una cancelacion o incidencia: texto corto, sin saltos de linea raros. */
function normalizeReason(value, { required = false, min = 3, max = 200 } = {}) {
    if (value === undefined || value === null || value === '') {
        return required ? { ok: false, code: 'reason_required', error: 'Indica el motivo.' } : { ok: true, reason: null };
    }
    if (typeof value !== 'string') return { ok: false, code: 'bad_reason', error: 'Motivo inválido.' };
    const reason = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (reason.length < min && (required || reason.length > 0)) return { ok: false, code: 'reason_required', error: `El motivo debe tener al menos ${min} caracteres.` };
    return { ok: true, reason: reason.slice(0, max) || null };
}

/**
 * Reembolso (total o parcial) de un pedido en linea YA pagado. El importe se calcula y limita en el servidor:
 * nunca supera lo cobrado menos lo ya reembolsado. Trabaja en centavos para no acumular errores de decimales.
 */
function planRefund({ order, amount, reason } = {}) {
    if (!order || order.paymentMethod !== 'online') return { ok: false, status: 409, code: 'not_online', error: 'Este pedido no tiene pago en línea.' };
    if (order.paymentStatus !== 'paid') {
        return { ok: false, status: 409, code: order.paymentStatus === 'refunded' ? 'already_refunded' : 'not_paid', error: order.paymentStatus === 'refunded' ? 'El pedido ya fue reembolsado por completo.' : 'Solo se reembolsan pedidos pagados.' };
    }
    const total = cents(order.total);
    const done = cents(order.refundedAmount || 0);
    const remaining = total - done;
    if (remaining <= 0) return { ok: false, status: 409, code: 'already_refunded', error: 'El pedido ya fue reembolsado por completo.' };
    let amt = remaining;
    if (amount !== undefined && amount !== null) {
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return { ok: false, status: 400, code: 'bad_amount', error: 'Importe inválido.' };
        amt = cents(amount);
        if (amt < 1) return { ok: false, status: 400, code: 'bad_amount', error: 'Importe inválido.' };
        if (amt > remaining) return { ok: false, status: 422, code: 'amount_exceeds', error: 'El importe supera lo que queda por reembolsar.' };
    }
    const why = normalizeReason(reason, { required: true });
    if (!why.ok) return { ok: false, status: 400, code: why.code, error: why.error };
    const after = done + amt;
    return { ok: true, amountCents: amt, doneCents: done, afterCents: after, full: after === total, reason: why.reason };
}

/** Categoria: nombre obligatorio al crear; descripcion corta; `active` booleano. */
function validateCategoryInput(input, { partial = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'bad_category', error: 'Datos inválidos.' };
    const out = {};
    if (input.name !== undefined || !partial) {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (name.length < 2 || name.length > 60) return { ok: false, code: 'bad_category', error: 'El nombre debe tener entre 2 y 60 caracteres.' };
        out.name = name;
    }
    if (input.description !== undefined) {
        if (typeof input.description !== 'string' || input.description.length > 200) return { ok: false, code: 'bad_category', error: 'La descripción admite hasta 200 caracteres.' };
        out.description = input.description.trim();
    }
    if (input.active !== undefined) {
        if (typeof input.active !== 'boolean') return { ok: false, code: 'bad_category', error: 'Estado inválido.' };
        out.active = input.active;
    }
    return { ok: true, data: out };
}

/** Entrada del registro de auditoria administrativa (sin datos personales: solo ids y un resumen corto). */
function buildAuditEntry({ actorId, actorRole, action, targetType = null, targetId = null, summary = '' }) {
    return {
        actorId: String(actorId || '').slice(0, 64),
        actorRole: String(actorRole || '').slice(0, 16),
        action: String(action || '').slice(0, 40),
        targetType: targetType ? String(targetType).slice(0, 24) : null,
        targetId: targetId ? String(targetId).slice(0, 64) : null,
        summary: String(summary || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 200)
    };
}

/** Si el usuario puede cambiar su estado (activar/desactivar cuenta): no a si mismo ni al ultimo administrador. */
function validateUserStatusChange({ actorId, targetId, active, targetLabels = [], otherActiveAdmins = 1 }) {
    if (typeof active !== 'boolean') return { ok: false, status: 400, code: 'bad_request', error: 'Indica el estado.' };
    if (actorId === targetId) return { ok: false, status: 409, code: 'self_disable', error: 'No puedes cambiar el estado de tu propia cuenta.' };
    if (!active && targetLabels.includes('admin') && otherActiveAdmins < 1) return { ok: false, status: 409, code: 'last_admin', error: 'No se puede desactivar al último administrador.' };
    return { ok: true };
}

/** Agrupa ventas diarias por semana (lunes) o mes: {periodo: centavos}. */
function groupSales(perDay, by = 'day') {
    const out = {};
    for (const [day, cts] of Object.entries(perDay || {})) {
        let key = day;
        if (by === 'month') key = day.slice(0, 7);
        if (by === 'week') {
            const d = new Date(`${day}T00:00:00Z`);
            const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
            d.setUTCDate(d.getUTCDate() - dow);
            key = d.toISOString().slice(0, 10);
        }
        out[key] = (out[key] || 0) + cts;
    }
    return out;
}

/**
 * Tablero del administrador a partir de pedidos reales (nada estimado).
 * Ventas = entregados (en linea: solo si estan pagados). Ingresos por metodo = entregados por metodo.
 */
function buildDashboard(orders, itemsByOrder = {}, { now = Date.now() } = {}) {
    const base = aggregateReport(orders, itemsByOrder);
    const todayKey = new Date(now).toISOString().slice(0, 10);
    let todayOrders = 0, cashCents = 0, onlineCents = 0, discountCents = 0, feeCents = 0, partialRefundCents = 0;
    let tipCents = 0, couponOrders = 0;
    const byDriver = {};
    const unpaidOnline = [];
    const paymentCounts = {};
    for (const o of orders || []) {
        if (!o) continue;
        if (String(o.$createdAt || '').slice(0, 10) === todayKey) todayOrders++;
        const ps = o.paymentStatus || (o.paymentMethod === 'online' ? 'pending' : 'not_required');
        paymentCounts[ps] = (paymentCounts[ps] || 0) + 1;
        if (o.status === 'delivered') {
            if (o.paymentMethod === 'online') onlineCents += cents(o.total); else cashCents += cents(o.total);
            discountCents += cents(o.discount || 0);
            feeCents += cents(o.deliveryFee || 0);
            tipCents += cents(o.tip || 0);
            if (o.couponCode) couponOrders++;
        }
        if (o.paymentStatus === 'paid' && Number(o.refundedAmount) > 0) partialRefundCents += cents(o.refundedAmount);
        if (o.paymentMethod === 'online' && ['pending', 'failed'].includes(o.paymentStatus || 'pending') && o.status !== 'cancelled') unpaidOnline.push(o.$id);
        if (o.driverUserId) {
            const d = (byDriver[o.driverUserId] ||= { driverUserId: o.driverUserId, name: o.driverName || 'Repartidor', delivered: 0, failed: 0, cancelled: 0, active: 0 });
            if (o.status === 'delivered') d.delivered++;
            else if (o.status === 'delivery_failed') d.failed++;
            else if (o.status === 'cancelled') d.cancelled++;
            else d.active++;
        }
    }
    return {
        ...base,
        todayOrders,
        revenueByMethod: { cash: cashCents / 100, online: onlineCents / 100 },
        discounts: discountCents / 100,
        deliveryFees: feeCents / 100,
        tips: tipCents / 100,
        couponOrders,
        ratings: summarizeRatings(orders),
        partialRefunds: partialRefundCents / 100,
        paymentCounts,
        unpaidOnlineOrders: unpaidOnline.length,
        drivers: Object.values(byDriver).sort((a, b) => b.delivered - a.delivered),
        pipeline: {
            pending: base.byStatus.pending || 0,
            accepted: base.byStatus.confirmed || 0,
            preparing: (base.byStatus.preparing || 0) + (base.byStatus.ready || 0),
            onTheWay: (base.byStatus.picked_up || 0) + (base.byStatus.on_the_way || 0),
            delivered: base.byStatus.delivered || 0
        }
    };
}


// ---------------------------------------------------------------------------------------------
// v14: horario, envio por distancia, cupones, propina, calificaciones y cancelacion del cliente.
// Todo se calcula en el servidor; la app solo muestra lo que el servidor devuelve.
// ---------------------------------------------------------------------------------------------
const MAX_TIP = 200;

function parseHm(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
    return h * 60 + mi;
}

/**
 * Horario de apertura. `hours`: "09:00-22:00" (o "22:00-02:00" que cruza medianoche); vacio = siempre abierto.
 * `utcOffsetHours`: zona horaria del restaurante (CDMX = -6). `forceClosed`: cierre manual inmediato.
 */
function isOpenNow({ hours = '', utcOffsetHours = 0, now = Date.now(), forceClosed = false } = {}) {
    const label = String(hours || '').trim();
    if (forceClosed) return { open: false, hours: label, reason: 'closed_manually' };
    if (!label) return { open: true, hours: '' };
    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(label);
    const from = m ? parseHm(m[1]) : null, to = m ? parseHm(m[2]) : null;
    if (from === null || to === null) return { open: true, hours: label, reason: 'bad_hours_config' };
    const local = new Date(now + (Number(utcOffsetHours) || 0) * 3600000);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const open = from === to ? true : from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    return { open, hours: label, ...(open ? {} : { reason: 'outside_hours' }) };
}

/** Envio = base + por km, con tope. Sin tarifa por km configurada se usa la tarifa fija. Devuelve pesos con centavos. */
function computeDeliveryFee({ km, base, perKm, max, fallback = 5 } = {}) {
    const per = Number(perKm);
    if (!Number.isFinite(per) || per <= 0 || typeof km !== 'number' || !Number.isFinite(km)) return cents(fallback) / 100;
    const b = Number.isFinite(Number(base)) ? Number(base) : fallback;
    let fee = cents(b) + Math.round(per * Math.max(0, km) * 100);
    const cap = Number(max);
    if (Number.isFinite(cap) && cap > 0) fee = Math.min(fee, cents(cap));
    return fee / 100;
}

/**
 * Cupones desde la variable COUPONS: "BIENVENIDO:percent:10:0;ENVIOGRATIS:freeship:0:100;MENOS20:amount:20:150"
 * (codigo:tipo:valor:minimo). Tipos: percent (% del subtotal), amount (monto fijo), freeship (envio gratis).
 */
function parseCoupons(raw) {
    const out = {};
    for (const part of String(raw || '').split(';')) {
        const [code, type, value, min] = part.split(':').map((x) => (x === undefined ? '' : x.trim()));
        if (!code || !['percent', 'amount', 'freeship'].includes(type)) continue;
        const v = Number(value || 0), mn = Number(min || 0);
        if (!Number.isFinite(v) || v < 0 || (type === 'percent' && v > 100)) continue;
        out[code.toUpperCase()] = { type, value: v, min: Number.isFinite(mn) && mn > 0 ? mn : 0 };
    }
    return out;
}

function applyCoupon({ code, coupons = {}, subtotal = 0, deliveryFee = 0 } = {}) {
    const key = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!key) return { ok: true, code: null, discount: 0 };
    if (!/^[A-Z0-9_-]{3,24}$/.test(key)) return { ok: false, code: 'coupon_invalid', error: 'Cupón inválido.' };
    const c = coupons[key];
    if (!c) return { ok: false, code: 'coupon_invalid', error: 'Ese cupón no existe o ya venció.' };
    if (c.min && cents(subtotal) < cents(c.min)) return { ok: false, code: 'coupon_min', error: `Este cupón requiere un pedido mínimo de $${c.min}.` };
    let d = 0;
    if (c.type === 'percent') d = Math.round((cents(subtotal) * c.value) / 100);
    else if (c.type === 'amount') d = cents(c.value);
    else d = cents(deliveryFee);
    d = Math.min(d, cents(subtotal) + cents(deliveryFee));
    return { ok: true, code: key, discount: d / 100, type: c.type };
}

/** Propina opcional al repartidor: 0..MAX_TIP, maximo 2 decimales. */
function validateTip(tip, { max = MAX_TIP } = {}) {
    if (tip === undefined || tip === null || tip === '') return { ok: true, tip: 0 };
    if (typeof tip !== 'number' || !Number.isFinite(tip) || tip < 0) return { ok: false, code: 'bad_tip', error: 'Propina inválida.' };
    const c = cents(tip);
    if (c > cents(max)) return { ok: false, code: 'bad_tip', error: `La propina máxima es $${max}.` };
    return { ok: true, tip: c / 100 };
}

/** Totales finales: subtotal + envio - descuentos (con tope) + propina. */
function finalizeTotals({ subtotal, deliveryFee, baseDiscount = 0, couponDiscount = 0, tip = 0 } = {}) {
    const gross = cents(subtotal) + cents(deliveryFee);
    const discount = Math.min(cents(baseDiscount) + cents(couponDiscount), gross);
    return {
        subtotal: cents(subtotal) / 100,
        deliveryFee: cents(deliveryFee) / 100,
        discount: discount / 100,
        tip: cents(tip) / 100,
        total: (gross - discount + cents(tip)) / 100
    };
}

/** Calificacion del pedido: 1..5 enteros, comentario opcional (max 300), calificacion del repartidor opcional. */
function validateRating(input) {
    if (!input || typeof input !== 'object') return { ok: false, code: 'bad_rating', error: 'Calificación inválida.' };
    const isStar = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
    if (!isStar(input.rating)) return { ok: false, code: 'bad_rating', error: 'Elige de 1 a 5 estrellas.' };
    if (input.driverRating !== undefined && input.driverRating !== null && !isStar(input.driverRating)) return { ok: false, code: 'bad_rating', error: 'La calificación del repartidor debe ser de 1 a 5.' };
    const comment = typeof input.comment === 'string' ? input.comment.replace(/\s+/g, ' ').trim() : '';
    if (comment.length > 300) return { ok: false, code: 'bad_rating', error: 'El comentario es demasiado largo (máx. 300).' };
    return { ok: true, rating: input.rating, driverRating: isStar(input.driverRating) ? input.driverRating : null, comment };
}

/** Promedio y distribucion de calificaciones de pedidos entregados. */
function summarizeRatings(orders) {
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0, count = 0, dSum = 0, dCount = 0;
    const recent = [];
    for (const o of orders || []) {
        if (!o || typeof o.rating !== 'number' || o.rating < 1 || o.rating > 5) continue;
        dist[o.rating]++; sum += o.rating; count++;
        if (typeof o.driverRating === 'number' && o.driverRating >= 1 && o.driverRating <= 5) { dSum += o.driverRating; dCount++; }
        if (o.ratingComment) recent.push({ orderId: o.$id, rating: o.rating, comment: o.ratingComment, at: o.ratedAt || o.$updatedAt || null });
    }
    recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return {
        count, average: count ? Math.round((sum / count) * 100) / 100 : null,
        driverAverage: dCount ? Math.round((dSum / dCount) * 100) / 100 : null,
        distribution: dist, recentComments: recent.slice(0, 5)
    };
}

// ---------------------------------------------------------------------------------------------
// MODO DEMOSTRACION (DEMO_AUTOPILOT=true): avanza los pedidos solo y usa repartidores FICTICIOS.
// Es una simulacion para presentar la app: no hay personas ni GPS reales. Solo la Function lo ejecuta.
// ---------------------------------------------------------------------------------------------
const DEMO_STEPS = {
    pending: { to: 'confirmed', delay: 0 },
    confirmed: { to: 'preparing', delay: 12 },
    preparing: { to: 'ready', delay: 20 },
    ready: { to: 'picked_up', delay: 8 },
    picked_up: { to: 'on_the_way', delay: 5 },
    on_the_way: { to: 'delivered', delay: null }
};
const DEMO_DRIVERS = ['Carlos (demo)', 'Marisol (demo)', 'Diego (demo)', 'Fernanda (demo)'];

/** Siguiente paso de la simulacion: { to, delay } en segundos (el viaje usa `tripSeconds`) o null si ya termino. */
function demoNextStep(status, tripSeconds = 90) {
    const step = DEMO_STEPS[status];
    if (!step) return null;
    return { to: step.to, delay: step.delay === null ? tripSeconds : step.delay };
}

/** Repartidor ficticio estable para un pedido (mismo pedido, mismo repartidor). */
function demoDriverFor(orderId) {
    let h = 0;
    for (const c of String(orderId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const i = h % DEMO_DRIVERS.length;
    return { id: `demo-driver-${i + 1}`, name: DEMO_DRIVERS[i] };
}

const lerpPoint = (a, b, p) => ({ latitude: a.latitude + (b.latitude - a.latitude) * p, longitude: a.longitude + (b.longitude - a.longitude) * p });

/**
 * Posicion simulada del repartidor segun el estado y el avance (0..1) dentro de ese estado:
 * preparing: llega hacia el restaurante desde ~1 km; ready: termina de llegar; picked_up: en el restaurante;
 * on_the_way: recorre en linea recta del restaurante al cliente. Devuelve null si faltan coordenadas.
 */
function demoPosition({ status, progress, restaurant, destination }) {
    if (!restaurant) return null;
    const p = Math.min(1, Math.max(0, Number(progress) || 0));
    const start = { latitude: restaurant.latitude + 0.008, longitude: restaurant.longitude + 0.008 };
    const mid = lerpPoint(start, restaurant, 0.5);
    if (status === 'preparing') return lerpPoint(start, mid, p);
    if (status === 'ready') return lerpPoint(mid, restaurant, p);
    if (status === 'picked_up') return { ...restaurant };
    if (status === 'on_the_way') return destination ? lerpPoint(restaurant, destination, p) : { ...restaurant };
    return null;
}

// =====================================================================================================
// V15 — roles, tiendas (multitienda) y administracion de usuarios.
// Rol = etiqueta de Auth (solo el servidor la escribe). Tienda = etiqueta `st<idTienda>` (tambien solo servidor).
// NUNCA se usan las preferencias (`prefs`) para esto: el propio usuario puede editarlas.
// Compatibilidad V14: un `admin` SIN etiqueta de tienda es administrador global (como en V14); `superadmin` es global siempre.
// =====================================================================================================
const DEFAULT_STORE_ID = 'main';
const STORE_LABEL_RE = /^st([A-Za-z0-9]{1,34})$/;
const CREATABLE_ROLES = { superadmin: ['admin', 'staff', 'driver', 'customer'], admin: ['staff', 'driver', 'customer'] };
const STORE_REQUIRED_ROLES = ['admin', 'staff', 'driver'];

const storeLabel = (storeId) => `st${storeId}`;
/** Id de tienda guardado en las etiquetas (null si no tiene). Ignora la etiqueta `staff`. */
function storeFromLabels(labels = []) {
    for (const l of labels || []) {
        if (l === 'staff') continue;
        const m = STORE_LABEL_RE.exec(String(l));
        if (m) return m[1];
    }
    return null;
}
/** Quien es el actor: rol, tienda y alcance. `global` => ve todas las tiendas. */
function actorScope(labels = []) {
    const l = Array.isArray(labels) ? labels : [];
    const superadmin = l.includes('superadmin');
    const admin = l.includes('admin');
    // Personal/repartidor de V14 (sin etiqueta de tienda) pertenece a la tienda por omision: asi no pierde acceso al migrar.
    const storeId = storeFromLabels(l) || (!admin && !superadmin && (l.includes('staff') || l.includes('driver')) ? DEFAULT_STORE_ID : null);
    const role = superadmin ? 'superadmin' : admin ? 'admin' : l.includes('staff') ? 'staff' : l.includes('driver') ? 'driver' : 'customer';
    return {
        role, storeId, superadmin,
        global: superadmin || (admin && !storeId),
        isAdmin: superadmin || admin,
        isStaff: superadmin || admin || l.includes('staff'),
        isDriver: l.includes('driver')
    };
}
/** Tienda a la que pertenece una fila (productos/pedidos anteriores a V15 no tienen `storeId` => tienda por omision). */
const storeOf = (row, fallback = DEFAULT_STORE_ID) => (row && typeof row.storeId === 'string' && row.storeId ? row.storeId : fallback);
/** ¿Puede el actor ver/operar datos de esa tienda? (global: todas; resto: solo la suya). */
function canAccessStore(scope, storeId) {
    if (!scope) return false;
    if (scope.global) return true;
    return !!scope.storeId && scope.storeId === (storeId || DEFAULT_STORE_ID);
}
const validStoreId = (id) => typeof id === 'string' && /^[A-Za-z0-9]{1,34}$/.test(id);

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
/** Roles que `actor` puede crear (sin elevar privilegios). */
const creatableRoles = (scope) => (scope && CREATABLE_ROLES[scope.role]) || [];

/**
 * Alta de usuario desde el panel. `store` = { exists, active } ya consultado por el servidor (o null si el rol no la necesita).
 * Devuelve { ok, data:{name,email,role,storeId,phone}, password? } o { ok:false, status, code, error }.
 */
function validateUserCreate({ scope, input, store = null } = {}) {
    const bad = (status, code, error) => ({ ok: false, status, code, error });
    if (!scope || !scope.isAdmin) return bad(403, 'forbidden', 'No tienes permiso para crear usuarios.');
    const i = input && typeof input === 'object' ? input : {};
    const name = typeof i.name === 'string' ? i.name.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 2 || name.length > 80) return bad(400, 'bad_name', 'El nombre debe tener entre 2 y 80 caracteres.');
    const email = typeof i.email === 'string' ? i.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 120) return bad(400, 'bad_email', 'Correo inválido.');
    const role = typeof i.role === 'string' ? i.role : 'customer';
    if (![...ROLE_LABELS, 'customer'].includes(role)) return bad(400, 'bad_role', 'Rol inválido.');
    if (!creatableRoles(scope).includes(role)) return bad(403, 'role_not_allowed', 'No puedes crear usuarios con ese rol.');
    let storeId = typeof i.storeId === 'string' && i.storeId ? i.storeId : null;
    if (!scope.global) {
        // Administrador de tienda: solo su tienda; si manda otra se rechaza (no se corrige en silencio).
        if (storeId && storeId !== scope.storeId) return bad(403, 'store_forbidden', 'Solo puedes crear usuarios en tu tienda.');
        storeId = scope.storeId;
    }
    if (STORE_REQUIRED_ROLES.includes(role) && !storeId) return bad(400, 'store_required', 'Ese rol necesita una tienda.');
    if (storeId && !validStoreId(storeId)) return bad(400, 'bad_store', 'Tienda inválida.');
    if (storeId) {
        if (!store || !store.exists) return bad(422, 'store_not_found', 'La tienda no existe.');
        if (store.active === false) return bad(422, 'store_inactive', 'La tienda está inactiva.');
    }
    let password = null;
    if (i.password !== undefined && i.password !== null && i.password !== '') {
        if (typeof i.password !== 'string' || i.password.length < 8 || i.password.length > 128) return bad(400, 'weak_password', 'La contraseña debe tener entre 8 y 128 caracteres.');
        password = i.password;
    }
    const phone = typeof i.phone === 'string' && i.phone.trim() ? i.phone.trim().slice(0, 20) : null;
    return { ok: true, data: { name, email, role, storeId, phone }, password };
}

/** Edicion de datos / rol / tienda de un usuario existente. */
function validateUserUpdate({ scope, actorId, targetId, targetLabels = [], input, store = null } = {}) {
    const bad = (status, code, error) => ({ ok: false, status, code, error });
    if (!scope || !scope.isAdmin) return bad(403, 'forbidden', 'No tienes permiso para editar usuarios.');
    const target = actorScope(targetLabels);
    if (target.superadmin && !scope.superadmin) return bad(403, 'role_not_allowed', 'No puedes modificar a un superadministrador.');
    if (!scope.global && target.global) return bad(403, 'store_forbidden', 'Ese usuario no pertenece a tu tienda.');
    if (!scope.global && target.storeId !== scope.storeId) return bad(403, 'store_forbidden', 'Ese usuario no pertenece a tu tienda.');
    const i = input && typeof input === 'object' ? input : {};
    const out = {};
    if (i.name !== undefined) {
        const name = typeof i.name === 'string' ? i.name.trim().replace(/\s+/g, ' ') : '';
        if (name.length < 2 || name.length > 80) return bad(400, 'bad_name', 'El nombre debe tener entre 2 y 80 caracteres.');
        out.name = name;
    }
    let role = target.role;
    if (i.role !== undefined) {
        if (![...ROLE_LABELS, 'customer'].includes(i.role)) return bad(400, 'bad_role', 'Rol inválido.');
        if (actorId === targetId && i.role !== target.role) return bad(403, 'self_role_change', 'No puedes cambiar tu propio rol.');
        if (i.role !== target.role && !creatableRoles(scope).includes(i.role)) return bad(403, 'role_not_allowed', 'No puedes asignar ese rol.');
        if (target.role === 'admin' && !scope.superadmin && i.role !== 'admin') return bad(403, 'role_not_allowed', 'Solo un superadministrador cambia el rol de un administrador.');
        role = i.role;
        out.role = role;
    }
    let storeId = target.storeId;
    if (i.storeId !== undefined) {
        if (actorId === targetId) return bad(403, 'self_store_change', 'No puedes cambiar tu propia tienda.');
        if (!scope.global) return bad(403, 'store_forbidden', 'Solo un superadministrador cambia a un usuario de tienda.');
        if (i.storeId !== null && !validStoreId(i.storeId)) return bad(400, 'bad_store', 'Tienda inválida.');
        storeId = i.storeId;
        out.storeId = storeId;
    }
    if (STORE_REQUIRED_ROLES.includes(role) && !storeId) return bad(400, 'store_required', 'Ese rol necesita una tienda.');
    if (out.storeId) {
        if (!store || !store.exists) return bad(422, 'store_not_found', 'La tienda no existe.');
        if (store.active === false) return bad(422, 'store_inactive', 'La tienda está inactiva.');
    }
    if (i.phone !== undefined) out.phone = typeof i.phone === 'string' ? i.phone.trim().slice(0, 20) : '';
    return { ok: true, data: out, role, storeId };
}

/** Etiquetas finales del usuario: se conservan las ajenas a la app y se reescriben rol + tienda. */
function composeLabels({ currentLabels = [], role, storeId }) {
    const foreign = (currentLabels || []).filter((l) => !ROLE_LABELS.includes(l) && !STORE_LABEL_RE.test(l));
    const labels = [...foreign];
    if (role && role !== 'customer') labels.push(role);
    if (storeId) labels.push(storeLabel(storeId));
    return labels;
}
/** El usuario puede ver al objetivo en el listado (aislamiento por tienda). */
function canSeeUser(scope, targetLabels = []) {
    if (!scope || !scope.isAdmin) return false;
    if (scope.global) return true;
    return actorScope(targetLabels).storeId === scope.storeId;
}

/** Datos de una tienda (alta/edicion). `partial` en edicion. Solo campos conocidos, con tipos y rangos. */
function validateStoreInput(input, { partial = false } = {}) {
    const bad = (code, error) => ({ ok: false, code, error });
    const i = input && typeof input === 'object' ? input : {};
    const d = {};
    const text = (k, max, { required = false } = {}) => {
        if (i[k] === undefined) return required && !partial ? bad('bad_store', `Falta ${k}.`) : null;
        if (typeof i[k] !== 'string' || i[k].trim().length > max || (required && i[k].trim().length < 2)) return bad('bad_store', `Campo inválido: ${k}.`);
        d[k] = i[k].trim();
        return null;
    };
    const num = (k, min, max) => {
        if (i[k] === undefined || i[k] === null) return null;
        const n = Number(i[k]);
        if (!Number.isFinite(n) || n < min || n > max) return bad('bad_store', `Campo inválido: ${k}.`);
        d[k] = n;
        return null;
    };
    for (const e of [text('name', 80, { required: true }), text('description', 300), text('imageUrl', 300), text('address', 200), text('phone', 20), text('openHours', 20), text('coupons', 500)]) if (e) return e;
    for (const e of [num('latitude', -90, 90), num('longitude', -180, 180), num('deliveryFee', 0, 10000), num('deliveryFeeBase', 0, 10000), num('deliveryFeePerKm', 0, 10000), num('deliveryFeeMax', 0, 10000), num('deliveryRadiusKm', 0, 500), num('prepMinutes', 1, 240)]) if (e) return e;
    if (d.openHours && d.openHours !== '' && !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(d.openHours)) return bad('bad_store', 'Horario inválido (usa HH:MM-HH:MM).');
    if (d.imageUrl && !/^https:\/\//.test(d.imageUrl)) return bad('bad_store', 'La imagen debe ser una URL https.');
    for (const k of ['active', 'closed']) {
        if (i[k] === undefined) continue;
        if (typeof i[k] !== 'boolean') return bad('bad_store', `Campo inválido: ${k}.`);
        d[k] = i[k];
    }
    if (partial && Object.keys(d).length === 0) return bad('bad_store', 'No hay cambios.');
    return { ok: true, data: d };
}
/** Config efectiva de una tienda: lo que defina su fila manda; lo demas cae a las variables de entorno (V14). */
function storeConfig(row, env = {}) {
    const r = row || {};
    const pick = (v, fb) => (v === undefined || v === null || v === '' ? fb : v);
    return {
        hours: pick(r.openHours, env.hours || ''),
        forceClosed: r.closed === true || (!row && env.forceClosed === true),
        prepMinutes: Number(r.prepMinutes) > 0 ? Number(r.prepMinutes) : env.prepMinutes,
        feeBase: pick(r.deliveryFeeBase, env.feeBase), feePerKm: pick(r.deliveryFeePerKm, env.feePerKm), feeMax: pick(r.deliveryFeeMax, env.feeMax),
        fallbackFee: Number.isFinite(Number(r.deliveryFee)) && r.deliveryFee !== undefined && r.deliveryFee !== null ? Number(r.deliveryFee) : env.fallbackFee,
        radiusKm: pick(r.deliveryRadiusKm, env.radiusKm),
        latitude: pick(r.latitude, env.latitude), longitude: pick(r.longitude, env.longitude),
        coupons: typeof r.coupons === 'string' && r.coupons.trim() ? r.coupons : env.coupons
    };
}
/** Vista publica de una tienda (clientes): nunca expone configuracion interna. */
function toStoreView(row, openState = null) {
    return {
        id: row.$id, name: row.name, description: row.description ?? '', imageUrl: row.imageUrl ?? '', address: row.address ?? '', phone: row.phone ?? '',
        active: row.active !== false, ...(openState ? { open: openState.open, hours: openState.hours || '' } : {})
    };
}

// ======================================================================= V16: finanzas, cuenta de repartidor, OTP, tiempo limite
/**
 * Reparto financiero de UN pedido entregado (pura, en centavos para no acumular errores de punto flotante).
 *   neto de productos = subtotal - descuento
 *   comision de plataforma = neto * platformPct / 100
 *   ingreso de tienda = neto - comision
 *   ganancia del repartidor = envio * driverPct / 100 + propina (la propina es 100% del repartidor)
 * Si hubo reembolso parcial o total, todo se escala por la parte no reembolsada. NO mueve dinero: solo calcula/registra.
 * Los porcentajes salen de la configuracion del servidor (nunca del cliente); sin configurar valen 0.
 */
const fin100 = (n) => Math.round((Number(n) || 0) * 100);
function splitFinance(order, cfg = {}) {
    const pct = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0; };
    const platformPct = pct(cfg.platformPct), driverPct = pct(cfg.driverPct);
    const subtotal = fin100(order.subtotal), fee = fin100(order.deliveryFee), discount = fin100(order.discount), tip = fin100(order.tip);
    const total = fin100(order.total);
    const refunded = Math.min(total, fin100(order.refundedAmount));
    const keep = total > 0 ? (total - refunded) / total : 1;
    const net = Math.max(0, subtotal - discount);
    const commission = Math.round(net * platformPct / 100);
    const driver = Math.round(fee * driverPct / 100) + tip;
    const scale = (c) => Math.round(c * keep);
    const out = {
        subtotal, deliveryFee: fee, discount, tip, total, refunded,
        platformCommission: scale(commission),
        storeRevenue: scale(net - commission),
        driverEarning: order.driverUserId ? scale(driver) : 0
    };
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v / 100]));
}

/** Agrega el reparto financiero de pedidos ENTREGADOS por tienda, por repartidor y por dia. */
function aggregateFinance(orders, cfgFor = () => ({})) {
    const sum = () => ({ orders: 0, total: 0, platformCommission: 0, storeRevenue: 0, driverEarning: 0, deliveryFee: 0, tips: 0, refunded: 0 });
    const add = (a, f) => { a.orders++; a.total += f.total; a.platformCommission += f.platformCommission; a.storeRevenue += f.storeRevenue; a.driverEarning += f.driverEarning; a.deliveryFee += f.deliveryFee; a.tips += f.tip; a.refunded += f.refunded; };
    const round = (a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k === 'orders' ? v : Math.round(v * 100) / 100]));
    const totals = sum(), byStore = {}, byDriver = {}, byDay = {};
    for (const o of orders) {
        if (o.status !== 'delivered') continue;
        const f = splitFinance(o, cfgFor(o));
        add(totals, f);
        add((byStore[o.storeId || 'main'] ||= sum()), f);
        if (o.driverUserId) add((byDriver[o.driverUserId] ||= { ...sum(), name: o.driverName || 'Repartidor' }), f);
        const day = String(o.$updatedAt || o.$createdAt || '').slice(0, 10);
        if (day) add((byDay[day] ||= sum()), f);
    }
    const fix = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)]));
    return { totals: round(totals), byStore: fix(byStore), byDriver: Object.fromEntries(Object.entries(byDriver).map(([k, v]) => [k, { ...round(v), name: v.name }])), byDay: fix(byDay) };
}

/** Estado de la cuenta de repartidor: pending (solicitud), approved, suspended (cuenta desactivada) o null (no es repartidor). */
const DRIVER_PENDING_LABEL = 'pdriver';
function driverAccountState(labels = [], active = true) {
    const l = Array.isArray(labels) ? labels : [];
    if (l.includes(DRIVER_PENDING_LABEL)) return active === false ? 'suspended' : 'pending';
    if (l.includes('driver')) return active === false ? 'suspended' : 'approved';
    return null;
}
/** Valida la solicitud de alta de repartidor (la hace una cuenta de cliente). */
function validateDriverApplication(input = {}) {
    const phone = typeof input.phone === 'string' ? input.phone.replace(/[^\d+]/g, '') : '';
    if (phone.replace(/\D/g, '').length < 10) return { ok: false, code: 'bad_phone', error: 'Escribe un teléfono de 10 dígitos.' };
    const vehicle = typeof input.vehicle === 'string' ? input.vehicle.trim().slice(0, 40) : '';
    if (!['bicicleta', 'moto', 'auto', 'a_pie'].includes(vehicle)) return { ok: false, code: 'bad_vehicle', error: 'Elige un vehículo válido.' };
    const storeId = typeof input.storeId === 'string' && input.storeId ? input.storeId : null;
    if (storeId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/.test(storeId)) return { ok: false, code: 'bad_store', error: 'Tienda inválida.' };
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
    return { ok: true, data: { phone: phone.slice(0, 16), vehicle, storeId, note } };
}

/** Codigo de entrega (OTP): 4 digitos derivados de HMAC(secreto, pedido). `hmac` lo inyecta la Function (node:crypto). */
function deliveryCode(hmac, orderId) {
    const hex = hmac(String(orderId));
    return String(parseInt(hex.slice(0, 8), 16) % 10000).padStart(4, '0');
}
const OTP_MAX_FAILS = 5;

/** ¿Una asignacion pendiente ya vencio? (tiempo limite de respuesta del repartidor; 0 = sin limite). */
function assignmentExpired(order, timeoutSeconds, now = Date.now()) {
    if (!(timeoutSeconds > 0) || !order.driverUserId || (order.driverResponse || 'accepted') !== 'pending') return false;
    const since = Date.parse(order.$updatedAt || order.$createdAt || '');
    return Number.isFinite(since) && now - since > timeoutSeconds * 1000;
}

export {
    DEFAULT_STORE_ID, STORE_LABEL_RE, CREATABLE_ROLES, STORE_REQUIRED_ROLES, storeLabel, storeFromLabels, actorScope, storeOf, canAccessStore, validStoreId, creatableRoles, validateUserCreate, validateUserUpdate, composeLabels, canSeeUser, validateStoreInput, storeConfig, toStoreView,
    MAX_TIP, isOpenNow, computeDeliveryFee, parseCoupons, applyCoupon, validateTip, finalizeTotals, validateRating, summarizeRatings,
    demoNextStep, demoDriverFor, demoPosition, DEMO_DRIVERS,
    TRANSITIONS, ACTIVE_DELIVERY, ASSIGNABLE, TERMINAL,
    canActorTransition, priceOrder, validateDriverPosition,
    validateAddressInput, validatePhone, distanceKm, checkCoverage, countOpenUnpaid, MAX_OPEN_UNPAID, countRecentOrders, MAX_ORDERS_PER_WINDOW,
    ROLE_LABELS, DEFAULT_LOW_STOCK, stockOf, totalsByMenu, checkStock, moveKey, isLowStock, validateProductInput, planStockAdjust,
    validateRoleChange, aggregateReport, toCsv, pickDriver, makeInventory, buildLowStockNotification, buildDriverRejectedNotification, canAssignDriver, toStaffOrderView,
    checkExpected, parseDateRange, matchesOrderQuery, buildOrderEvent, isMenuAvailable,
    PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TRANSITIONS, CURRENCY, validatePaymentMethod, movePaymentStatus,
    buildCheckoutSessionParams, formEncode, checkSessionPayment, paymentIntentId,
    parseStripeSignatureHeader, isFreshTimestamp, signedPayload, stripeEventToPayment, stripeRequest, isStripeCheckoutUrl,
    POOL_STATUSES, toPoolView, buildDriverCancelledNotification, DRIVER_STALE_MS, IN_TRANSIT, driverState, normalizeReason, planRefund, validateCategoryInput, buildAuditEntry, validateUserStatusChange, groupSales, buildDashboard,
    buildStatusNotification, buildOrderReceivedNotification, buildAssignmentNotification, buildPaymentNotification, buildPushRequest,
    splitFinance, aggregateFinance, driverAccountState, validateDriverApplication, DRIVER_PENDING_LABEL, deliveryCode, OTP_MAX_FAILS, assignmentExpired
};
