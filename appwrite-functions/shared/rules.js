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

/**
 * Cuerpo de la preferencia de Mercado Pago (Checkout Pro). Un solo concepto con el
 * total ya calculado por el servidor: el cliente nunca decide el importe.
 */
function buildPreferenceBody({ orderId, total, returnUrl, currency = 'MXN' }) {
    return {
        items: [{ id: orderId, title: `Pedido Delivery #${String(orderId).slice(-6)}`, quantity: 1, unit_price: Number(total), currency_id: currency }],
        external_reference: orderId,
        back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
        auto_return: 'approved'
    };
}

/**
 * Entre los pagos devueltos por Mercado Pago, busca uno aprobado cuyo importe y
 * moneda coincidan EXACTAMENTE con el pedido (evita pagar de menos).
 */
function pickApprovedPayment(results, { total, currency = 'MXN' }) {
    if (!Array.isArray(results)) return null;
    const cents = (n) => Math.round((Number(n) + Number.EPSILON) * 100);
    return results.find((p) => p && p.status === 'approved' && p.currency_id === currency && cents(p.transaction_amount) === cents(total)) || null;
}

/** Estado mas reciente informado por Mercado Pago (para mostrar al usuario). */
function latestPaymentStatus(results) {
    if (!Array.isArray(results) || results.length === 0) return null;
    const sorted = [...results].sort((a, b) => String(b.date_created || '').localeCompare(String(a.date_created || '')));
    return typeof sorted[0].status === 'string' ? sorted[0].status : null;
}

const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;
const isExpoPushToken = (t) => typeof t === 'string' && EXPO_TOKEN_RE.test(t);

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
    return { title: m[0], body: m[1], data: { type: 'order_status', orderId, status }, channelId: 'orders', sound: 'default' };
}

function buildAssignmentNotification(orderId) {
    return { title: 'Nueva entrega asignada', body: `Tienes el pedido #${String(orderId).slice(-6)} por entregar.`, data: { type: 'driver_assigned', orderId }, channelId: 'orders', sound: 'default' };
}

/**
 * Interpreta la respuesta de Expo y devuelve los tokens que ya no sirven
 * (DeviceNotRegistered) para borrarlos. `tokens` conserva el orden del envio.
 */
function tokensToPurge(response, tokens) {
    const tickets = response && Array.isArray(response.data) ? response.data : [];
    const out = [];
    tickets.forEach((t, i) => {
        if (t && t.status === 'error' && t.details && t.details.error === 'DeviceNotRegistered' && tokens[i]) out.push(tokens[i]);
    });
    return out;
}

module.exports = {
    TRANSITIONS, ACTIVE_DELIVERY, ASSIGNABLE, TERMINAL,
    canActorTransition, priceOrder, validateDriverPosition,
    validateAddressInput, validatePhone, canAssignDriver, toStaffOrderView,
    checkExpected, parseDateRange, matchesOrderQuery, buildOrderEvent, isMenuAvailable,
    PAYMENT_METHODS, validatePaymentMethod, buildPreferenceBody, pickApprovedPayment, latestPaymentStatus,
    isExpoPushToken, buildStatusNotification, buildAssignmentNotification, tokensToPurge
};
