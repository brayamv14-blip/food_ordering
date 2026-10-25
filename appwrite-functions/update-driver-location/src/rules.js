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
    preparing: ['on_the_way'],
    on_the_way: ['delivered'],
    delivered: [],
    cancelled: []
};

/** Que rol puede pedir cada transicion. El cliente solo cancela pedidos pendientes. */
function canActorTransition({ actor, isOwner, from, to, hasDriver = true }) {
    if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) {
        return { ok: false, code: 'invalid_transition', error: 'Transición no permitida.' };
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
        const qty = Number(it.quantity);
        if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
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
        customerName: order.customerName || '',
        customerPhone: order.customerPhone || '',
        deliveryAddress: order.deliveryAddress || '',
        driverUserId: order.driverUserId || null,
        driverName: order.driverName || null,
        items: items.map((i) => ({ name: i.name, quantity: i.quantity }))
    };
}

export {
    TRANSITIONS, ACTIVE_DELIVERY, ASSIGNABLE, TERMINAL,
    canActorTransition, priceOrder, validateDriverPosition,
    validateAddressInput, validatePhone, canAssignDriver, toStaffOrderView
};
