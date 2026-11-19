import { createHash, randomBytes } from 'node:crypto';
import { Account, Client, ID, Query, TablesDB, Users } from 'node-appwrite';
import {
    DEFAULT_LOW_STOCK, aggregateReport, isLowStock, parseDateRange, planStockAdjust, stockOf, toCsv,
    validateProductInput, validateRoleChange, makeInventory, buildDashboard, validateCategoryInput, buildAuditEntry, validateUserStatusChange,
    ACTIVE_DELIVERY, IN_TRANSIT, driverState,
    DEFAULT_STORE_ID, actorScope, storeOf, canAccessStore, aggregateFinance, driverAccountState, DRIVER_PENDING_LABEL, validateUserCreate, validateUserUpdate, composeLabels, canSeeUser, validateStoreInput, storeLabel, validStoreId
} from './rules.js';

/**
 * Administracion (productos, inventario, usuarios/roles, pagos y reportes). Contrato: campo `action` del JSON.
 *
 *   Personal (etiqueta `staff` o `admin`):
 *     listProducts, listCategories, setProductAvailability, adjustStock, stockMovements, listPayments, report
 *   Solo administrador (etiqueta `admin`):
 *     saveProduct (crear/editar: precio, imagen, categoria, datos), listUsers, setRole
 *
 * La autorizacion se decide aqui con las etiquetas de la cuenta; la interfaz solo oculta botones.
 * Los cambios de precio/producto son solo de admin porque afectan el cobro de TODOS los pedidos.
 */
const DB = process.env.DATABASE_ID;
const ORDERS = process.env.ORDERS_TABLE_ID;
const ITEMS = process.env.ORDER_ITEMS_TABLE_ID;
const MENU = process.env.MENU_TABLE_ID;
const CATEGORIES = process.env.CATEGORIES_TABLE_ID;
const MOVES = process.env.INVENTORY_MOVES_TABLE_ID;
const STORES = process.env.STORES_TABLE_ID; // V15: multitienda (si falta, el sistema se comporta como V14: una sola tienda)
const RECOVERY_URL = process.env.RECOVERY_URL; // V15: pagina de recuperacion de contraseña (la misma de EXPO_PUBLIC_RECOVERY_URL)
const AUDIT = process.env.AUDIT_TABLE_ID; // opcional: registro de acciones administrativas
const MAX_ACTIVE_PER_DRIVER = Number(process.env.MAX_ACTIVE_PER_DRIVER ?? 3);
const MAX_REPORT_ORDERS = 2000;
// V16: reparto financiero. Porcentajes por servidor (por tienda se pueden sobreescribir con columnas opcionales platformPct/driverPct).
const PLATFORM_PCT = Number(process.env.PLATFORM_COMMISSION_PCT ?? 0);
const DRIVER_PCT = Number(process.env.DRIVER_FEE_PCT ?? 100);
const MAX_PRODUCTS = 1000;

const fail = (res, status, code, error) => res.json({ code, error }, status);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const productView = (r) => {
    const stock = stockOf(r);
    const threshold = Number.isInteger(r.lowStockThreshold) ? r.lowStockThreshold : DEFAULT_LOW_STOCK;
    return {
        id: r.$id, name: r.name, price: r.price, description: r.description ?? '', image_url: r.image_url ?? '',
        type: r.type ?? null, categories: typeof r.categories === 'string' ? r.categories : r.categories?.$id ?? null,
        available: r.available !== false, stock, tracked: stock !== null, lowStock: isLowStock(stock, threshold), lowStockThreshold: threshold
    };
};

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
    const action = typeof body.action === 'string' ? body.action : '';

    try {
        const me = await users.get({ userId });
        const labels = me.labels ?? [];
        const scope = actorScope(labels);
        const isAdmin = scope.isAdmin;
        const isStaff = scope.isStaff;
        if (!isStaff) return fail(res, 403, 'forbidden', 'Solo personal autorizado.');
        const MULTI = !!STORES;
        const needAdmin = () => (isAdmin ? null : fail(res, 403, 'forbidden', 'Solo administradores.'));
        const needGlobal = () => (scope.global ? null : fail(res, 403, 'forbidden', 'Solo el superadministrador.'));
        const needSuper = () => (scope.superadmin ? null : fail(res, 403, 'forbidden', 'Solo el superadministrador.'));
        // Tienda con la que se trabaja: la del actor; el superadministrador puede elegir otra con `storeId`.
        const targetStore = () => (scope.global ? (typeof body.storeId === 'string' && body.storeId ? body.storeId : null) : scope.storeId);
        /** Aislamiento por tienda: sin multitienda no filtra nada (comportamiento V14). */
        const rowVisible = (row) => { if (!MULTI) return true; const t = targetStore(); return canAccessStore(scope, storeOf(row)) && (!t || storeOf(row) === t); };
        // V16: categorias por tienda. Una categoria sin `storeId` es comun (heredada de V14/V15): la ven todas las tiendas, pero solo la edita el alcance global.
        const catStore = (row) => (row && typeof row.storeId === 'string' && row.storeId ? row.storeId : null);
        const catVisible = (row) => { if (!MULTI) return true; const c = catStore(row); const t = targetStore(); if (!c) return true; return canAccessStore(scope, c) && (!t || c === t); };
        const catEditable = (row) => { if (!MULTI) return true; const c = catStore(row); return c ? canAccessStore(scope, c) : scope.global; };
        const catView = (c) => ({ id: c.$id, name: c.name, description: c.description ?? '', active: c.active !== false, storeId: catStore(c), shared: MULTI && !catStore(c) });
        const storeFromLabelsV = (l) => actorScope(l).storeId || null;
        const getStore = async (id) => (MULTI && validStoreId(id) ? db.getRow({ databaseId: DB, tableId: STORES, rowId: id }).catch(() => null) : null);
        const storeView = (r) => ({ id: r.$id, name: r.name, description: r.description ?? '', imageUrl: r.imageUrl ?? '', address: r.address ?? '', phone: r.phone ?? '', active: r.active !== false, closed: r.closed === true, openHours: r.openHours ?? '', latitude: r.latitude ?? null, longitude: r.longitude ?? null, deliveryFee: r.deliveryFee ?? null, deliveryFeeBase: r.deliveryFeeBase ?? null, deliveryFeePerKm: r.deliveryFeePerKm ?? null, deliveryFeeMax: r.deliveryFeeMax ?? null, deliveryRadiusKm: r.deliveryRadiusKm ?? null, platformPct: typeof r.platformPct === 'number' ? r.platformPct : null, driverPct: typeof r.driverPct === 'number' ? r.driverPct : null, prepMinutes: r.prepMinutes ?? null, coupons: r.coupons ?? '', createdAt: r.$createdAt, updatedAt: r.$updatedAt });
        const userView = (u) => { const sc = actorScope(u.labels); return { id: u.$id, name: u.name || '(sin nombre)', email: u.email ?? null, role: sc.role, storeId: sc.storeId, active: u.status !== false, createdAt: u.$createdAt ?? null, labels: (u.labels ?? []).filter((l) => ['superadmin', 'admin', 'staff', 'driver'].includes(l)) }; };
        const inventory = makeInventory({ db, DB, MENU, MOVES, Query, hash });

        /** Registro de acciones administrativas importantes (mejor esfuerzo; siempre queda tambien en el log de la Function). */
        const audit = async (act, targetType, targetId, summary) => {  // V15: actorRole real (superadmin/admin/staff)
            log(`audit action=${act} target=${targetType}:${targetId} actor=${userId}`);
            if (!AUDIT) return;
            try { await db.createRow({ databaseId: DB, tableId: AUDIT, rowId: ID.unique(), data: buildAuditEntry({ actorId: userId, actorRole: scope.role, action: act, targetType, targetId, summary }) }); } catch (e) { error(`audit_failed: ${e.message}`); }
        };
        /** Pedidos del rango (paginado, con tope) y articulos de los entregados. */
        const loadOrders = async (range) => {
            const base = [];
            if (range.from) base.push(Query.greaterThanEqual('$createdAt', range.from));
            if (range.to) base.push(Query.lessThanEqual('$createdAt', range.to));
            const orders = [];
            for (let offset = 0; offset < MAX_REPORT_ORDERS; offset += 100) {
                const page = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [...base, Query.orderAsc('$createdAt'), Query.limit(100), Query.offset(offset)] })).rows;
                orders.push(...page);
                if (page.length < 100) break;
            }
            const truncated = orders.length >= MAX_REPORT_ORDERS;
            const mine = orders.filter(rowVisible);
            const deliveredIds = mine.filter((o) => o.status === 'delivered').map((o) => o.$id);
            const itemsByOrder = {};
            for (let i = 0; i < deliveredIds.length && ITEMS; i += 50) {
                const rows = (await db.listRows({ databaseId: DB, tableId: ITEMS, queries: [Query.equal('orderId', deliveredIds.slice(i, i + 50)), Query.limit(500)] })).rows;
                for (const r of rows) (itemsByOrder[r.orderId] ??= []).push(r);
            }
            return { orders: mine, itemsByOrder, truncated };
        };

        const logMove = async (data, key) => {
            if (!MOVES) return;
            try {
                await db.createRow({ databaseId: DB, tableId: MOVES, rowId: key ? inventory.rowIdFor('reserve', 'adj:' + key, 'x') : ID.unique(), data });
            } catch (e) {
                error(`move_failed: ${e.message}`);
            }
        };

        switch (action) {
            case 'whoami':
                return res.json({ admin: isAdmin, staff: true, role: scope.role, storeId: scope.storeId, global: scope.global, superadmin: scope.superadmin, multiStore: MULTI, inventoryEnabled: !!MOVES });

            case 'listProducts': {
                const rows = [];
                let truncated = false;
                for (let offset = 0; ; offset += 100) {
                    const page = (await db.listRows({ databaseId: DB, tableId: MENU, queries: [Query.limit(100), Query.offset(offset)] })).rows;
                    rows.push(...page);
                    if (page.length < 100) break;
                    if (rows.length >= MAX_PRODUCTS) { truncated = true; break; }
                }
                const q = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
                const list = rows.filter(rowVisible).map((r) => ({ ...productView(r), storeId: storeOf(r) })).filter((p) => !q || p.name.toLowerCase().includes(q));
                return res.json({ products: list, lowStock: list.filter((p) => p.lowStock).length, inventoryEnabled: !!MOVES, truncated });
            }

            case 'listCategories': {
                if (!CATEGORIES) return res.json({ categories: [] });
                const rows = (await db.listRows({ databaseId: DB, tableId: CATEGORIES, queries: [Query.limit(100)] })).rows.filter(catVisible);
                return res.json({ categories: rows.map(catView) });
            }

            case 'saveProduct': {
                const denied = needAdmin();
                if (denied) return denied;
                const editing = typeof body.productId === 'string';
                const v = validateProductInput(body.product, { partial: editing });
                if (!v.ok) return fail(res, 422, v.code, v.error);
                if (v.data.categories && CATEGORIES) {
                    const cat = await db.getRow({ databaseId: DB, tableId: CATEGORIES, rowId: v.data.categories }).catch(() => null);
                    if (!cat) return fail(res, 422, 'bad_product', 'La categoría no existe.');
                    // V16: la categoria debe ser de la misma tienda que el producto (o comun).
                    if (MULTI && catStore(cat)) {
                        const prodStore = editing
                            ? storeOf(await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId }).catch(() => null))
                            : (scope.global ? (typeof body.storeId === 'string' && body.storeId ? body.storeId : DEFAULT_STORE_ID) : scope.storeId);
                        if (catStore(cat) !== prodStore) return fail(res, 422, 'category_other_store', 'Esa categoría pertenece a otra tienda.');
                    }
                }
                if (editing) {
                    const before = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId }).catch(() => null);
                    if (!before || (MULTI && !canAccessStore(scope, storeOf(before)))) return fail(res, 404, 'not_found', 'Producto no encontrado.');
                    // La tienda de un producto no se cambia por aqui (evita mover o robar productos entre tiendas).
                    // El stock no se cambia por aqui (usa adjustStock para que quede historial y sea atomico).
                    delete v.data.stock;
                    const row = await db.updateRow({ databaseId: DB, tableId: MENU, rowId: body.productId, data: v.data });
                    await audit('product_update', 'product', body.productId, `Campos: ${Object.keys(v.data).join(', ')}`);
                    return res.json({ product: productView(row) });
                }
                const initialStock = body.product && body.product.stock !== undefined ? v.data.stock : null;
                let productStore = null;
                if (MULTI) {
                    productStore = scope.global ? (typeof body.storeId === 'string' && body.storeId ? body.storeId : DEFAULT_STORE_ID) : scope.storeId;
                    if (!productStore) return fail(res, 403, 'store_required', 'Tu cuenta no tiene tienda asignada.');
                    const st = await getStore(productStore);
                    if (!st) return fail(res, 422, 'store_not_found', 'La tienda no existe.');
                    if (st.active === false) return fail(res, 422, 'store_inactive', 'La tienda está inactiva.');
                }
                const data = { ...v.data, available: v.data.available !== false, stock: initialStock ?? null, ...(productStore ? { storeId: productStore } : {}) };
                const row = await db.createRow({ databaseId: DB, tableId: MENU, rowId: ID.unique(), data });
                await audit('product_create', 'product', row.$id, String(v.data.name || '').slice(0, 80));
                if (typeof initialStock === 'number') await logMove({ ...(productStore ? { storeId: productStore } : {}), menuId: row.$id, orderId: 'manual', type: 'initial', quantity: initialStock, delta: initialStock, reason: 'initial', actorId: userId });
                return res.json({ product: productView(row) });
            }

            case 'setProductAvailability': {
                if (typeof body.productId !== 'string' || typeof body.available !== 'boolean') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const exists = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId }).catch(() => null);
                if (!exists || (MULTI && !canAccessStore(scope, storeOf(exists)))) return fail(res, 404, 'not_found', 'Producto no encontrado.');
                const row = await db.updateRow({ databaseId: DB, tableId: MENU, rowId: body.productId, data: { available: body.available } });
                await audit('product_availability', 'product', body.productId, body.available ? 'activado' : 'desactivado');
                return res.json({ product: productView(row) });
            }

            case 'adjustStock': {
                if (!MOVES) return fail(res, 503, 'inventory_disabled', 'El inventario no está configurado en el servidor.');
                if (typeof body.productId !== 'string') return fail(res, 400, 'bad_request', 'Falta el producto.');
                const product = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId }).catch(() => null);
                if (!product || (MULTI && !canAccessStore(scope, storeOf(product)))) return fail(res, 404, 'not_found', 'Producto no encontrado.');
                const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 120) : '';
                const key = typeof body.clientRequestId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.clientRequestId) ? body.clientRequestId : null;
                const current = stockOf(product);
                // Reintento con el mismo identificador: no se aplica dos veces.
                if (key) {
                    const dup = await db.getRow({ databaseId: DB, tableId: MOVES, rowId: inventory.rowIdFor('reserve', 'adj:' + key, 'x') }).catch(() => null);
                    if (dup) return res.json({ product: productView(product), duplicate: true });
                }
                const plan = planStockAdjust(current, { set: body.set, delta: body.delta });
                if (!plan.ok) return fail(res, 422, plan.code, plan.error);
                if (current === null) {
                    await db.updateRow({ databaseId: DB, tableId: MENU, rowId: body.productId, data: { stock: plan.next } });
                } else if (plan.delta > 0) {
                    await inventory.increment(body.productId, plan.delta);
                } else if (plan.delta < 0) {
                    // Mismo descuento seguro que las compras: si el stock cambio mientras ajustabas, no queda negativo.
                    const dec = await inventory.decrement(body.productId, -plan.delta);
                    if (!dec.ok) return fail(res, 409, 'insufficient_stock', 'El stock cambió mientras ajustabas; vuelve a intentarlo.');
                }
                await logMove({ ...(MULTI ? { storeId: storeOf(product) } : {}), menuId: body.productId, orderId: 'manual', type: 'adjust', quantity: Math.abs(plan.delta), delta: plan.delta, reason: reason || 'manual', actorId: userId }, key);
                const row = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId });
                await audit('stock_adjust', 'product', body.productId, `delta ${plan.delta} (${reason || 'manual'})`);
                return res.json({ product: productView(row) });
            }

            case 'stockMovements': {
                if (!MOVES) return res.json({ movements: [], enabled: false });
                const queries = [Query.orderDesc('$createdAt'), Query.limit(50)];
                if (typeof body.productId === 'string') queries.unshift(Query.equal('menuId', body.productId));
                let rows = (await db.listRows({ databaseId: DB, tableId: MOVES, queries })).rows;
                if (MULTI) {
                    // Solo movimientos de productos de la tienda del actor.
                    const ids = [...new Set(rows.map((m) => m.menuId).filter(Boolean))];
                    const prods = ids.length ? (await db.listRows({ databaseId: DB, tableId: MENU, queries: [Query.equal('$id', ids), Query.limit(100)] })).rows : [];
                    const ok = new Set(prods.filter(rowVisible).map((p) => p.$id));
                    rows = rows.filter((m) => ok.has(m.menuId));
                }
                return res.json({ enabled: true, movements: rows.map((m) => ({ id: m.$id, menuId: m.menuId, orderId: m.orderId, type: m.type, delta: m.delta, reason: m.reason ?? null, at: m.$createdAt })) });
            }

            case 'listPayments': {
                const range = parseDateRange(body);
                if (!range.ok) return fail(res, 400, range.code, range.error);
                const method = body.paymentMethod === 'cash_on_delivery' ? 'cash_on_delivery' : 'online';
                const queries = [Query.equal('paymentMethod', [method]), Query.orderDesc('$createdAt'), Query.limit(100)];
                if (body.paymentStatus !== undefined) {
                    if (!['pending', 'paid', 'failed', 'cancelled', 'refunded'].includes(body.paymentStatus)) return fail(res, 400, 'bad_status', 'Estado de pago inválido.');
                    queries.unshift(Query.equal('paymentStatus', body.paymentStatus));
                }
                if (range.from) queries.unshift(Query.greaterThanEqual('$createdAt', range.from));
                if (range.to) queries.unshift(Query.lessThanEqual('$createdAt', range.to));
                const all = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries })).rows;
                const rows = all.filter(rowVisible);
                return res.json({
                    truncated: all.length >= 100,
                    payments: rows.map((o) => ({
                        orderId: o.$id, total: o.total, paymentMethod: method, paymentStatus: o.paymentStatus ?? (method === 'online' ? 'pending' : 'not_required'), orderStatus: o.status,
                        refundedAmount: Number(o.refundedAmount) > 0 ? Number(o.refundedAmount) : 0,
                        // Solo el final del identificador de Stripe: suficiente para conciliar sin exponerlo completo.
                        reference: o.paymentId ? `…${String(o.paymentId).slice(-6)}` : null, at: o.$createdAt
                    }))
                });
            }

            case 'report': {
                const range = parseDateRange(body);
                if (!range.ok) return fail(res, 400, range.code, range.error);
                const { orders, itemsByOrder, truncated } = await loadOrders(range);
                const report = aggregateReport(orders, itemsByOrder);
                const out = { report, truncated, from: range.from ?? null, to: range.to ?? null };
                if (body.format === 'csv') {
                    out.csv = toCsv(orders.map((o) => ({ pedido: o.$id, fecha: o.$createdAt, estado: o.status, metodo_pago: o.paymentMethod, estado_pago: o.paymentStatus ?? '', total: o.total })),
                        ['pedido', 'fecha', 'estado', 'metodo_pago', 'estado_pago', 'total']);
                }
                return res.json(out);
            }

            case 'reconcileInventory': {
                // Repara devoluciones de stock que fallaron a mitad de camino. Idempotente: se puede ejecutar las veces que haga falta.
                // V15: opera sobre todas las tiendas => solo alcance global.
                const denied = needGlobal();
                if (denied) return denied;
                if (!MOVES) return fail(res, 503, 'inventory_disabled', 'El inventario no está configurado en el servidor.');
                const result = { releasedOrders: 0, orphanOrders: 0, staleUnpaid: [] };
                // 1) Pedidos cancelados con reserva sin devolver.
                const cancelled = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('status', ['cancelled']), Query.equal('stockReserved', [true]), Query.orderDesc('$createdAt'), Query.limit(100)] })).rows;
                for (const o of cancelled) {
                    const r = await inventory.release(o.$id, 'reconcile');
                    if (r.released.length) result.releasedOrders++;
                }
                // 2) Reservas huerfanas: el pedido nunca llego a crearse (o se borro). Se ignoran los ajustes manuales.
                const reserves = (await db.listRows({ databaseId: DB, tableId: MOVES, queries: [Query.equal('type', ['reserve']), Query.orderDesc('$createdAt'), Query.limit(100)] })).rows;
                const seen = new Set();
                for (const m of reserves) {
                    if (seen.has(m.orderId) || m.orderId === 'manual') continue;
                    seen.add(m.orderId);
                    const order = await db.getRow({ databaseId: DB, tableId: ORDERS, rowId: m.orderId }).catch(() => null);
                    if (!order) {
                        const r = await inventory.release(m.orderId, 'reconcile_orphan');
                        if (r.released.length) result.orphanOrders++;
                    }
                }
                // 3) Solo informativo: pedidos en linea sin pagar con mas de 2 h reteniendo stock (el personal decide cancelarlos).
                const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
                const stale = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('status', ['pending']), Query.equal('paymentMethod', ['online']), Query.lessThanEqual('$createdAt', cutoff), Query.limit(50)] })).rows;
                result.staleUnpaid = stale.filter((o) => ['pending', 'failed'].includes(o.paymentStatus || 'pending') && o.stockReserved === true).map((o) => o.$id);
                return res.json(result);
            }

            case 'dashboard': {
                // Finanzas y rendimiento: solo administrador (incluye importes por metodo de pago, descuentos y reembolsos).
                const denied = needAdmin();
                if (denied) return denied;
                const range = parseDateRange(body);
                if (!range.ok) return fail(res, 400, range.code, range.error);
                const { orders, itemsByOrder, truncated } = await loadOrders(range);
                const dashboard = buildDashboard(orders, itemsByOrder);
                // Repartidores: estado ACTUAL (no depende del rango): desconectado / disponible / ocupado.
                const drvAll = await users.list({ queries: [Query.equal('labels', ['driver']), Query.limit(100)] });
                const drvUsers = { users: MULTI ? drvAll.users.filter((u) => { const t = targetStore(); return canSeeUser(scope, u.labels) && (!t || actorScope(u.labels).storeId === t); }) : drvAll.users };
                const active = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('status', ACTIVE_DELIVERY), Query.limit(200)] })).rows.filter(rowVisible);
                const load = {}, transit = {};
                for (const o of active) if (o.driverUserId) { load[o.driverUserId] = (load[o.driverUserId] || 0) + 1; if (IN_TRANSIT.includes(o.status)) transit[o.driverUserId] = (transit[o.driverUserId] || 0) + 1; }
                const driversSummary = { total: drvUsers.users.length, available: 0, busy: 0, offline: 0 };
                for (const u of drvUsers.users) {
                    const s = driverState({ available: !(u.prefs && u.prefs.driverAvailable === false) && u.status !== false, lastSeenAt: u.prefs && u.prefs.driverLastSeenAt, active: load[u.$id] || 0, inTransit: transit[u.$id] || 0, maxActive: MAX_ACTIVE_PER_DRIVER });
                    driversSummary[s.status]++;
                }
                return res.json({ dashboard, driversSummary, truncated, from: range.from ?? null, to: range.to ?? null });
            }

            case 'saveCategory': {
                const denied = needAdmin();
                if (denied) return denied;
                if (!CATEGORIES) return fail(res, 503, 'categories_disabled', 'Las categorías no están configuradas en el servidor.');
                const editing = typeof body.categoryId === 'string';
                const v = validateCategoryInput(body.category, { partial: editing });
                if (!v.ok) return fail(res, 422, v.code, v.error);
                if (editing) {
                    const before = await db.getRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId }).catch(() => null);
                    if (!before || !catVisible(before)) return fail(res, 404, 'not_found', 'Categoría no encontrada.');
                    if (!catEditable(before)) return fail(res, 403, 'forbidden', 'Esa categoría es común; solo el superadministrador puede editarla.');
                    const row = await db.updateRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId, data: v.data });
                    await audit('category_update', 'category', row.$id, Object.keys(v.data).join(', '));
                    return res.json({ category: catView(row) });
                }
                let newStore = null;
                if (MULTI) {
                    newStore = scope.global ? (typeof body.storeId === 'string' && body.storeId ? body.storeId : null) : scope.storeId;
                    if (!newStore && !scope.global) return fail(res, 403, 'store_required', 'Tu cuenta no tiene tienda asignada.');
                    if (newStore) {
                        const st = await getStore(newStore);
                        if (!st) return fail(res, 422, 'store_not_found', 'La tienda no existe.');
                        if (st.active === false) return fail(res, 422, 'store_inactive', 'La tienda está inactiva.');
                    }
                }
                const row = await db.createRow({ databaseId: DB, tableId: CATEGORIES, rowId: ID.unique(), data: { description: '', ...v.data, ...(newStore ? { storeId: newStore } : {}) } });
                await audit('category_create', 'category', row.$id, String(v.data.name).slice(0, 60));
                return res.json({ category: catView(row) });
            }

            case 'setCategoryActive': {
                const denied = needAdmin();
                if (denied) return denied;
                if (!CATEGORIES) return fail(res, 503, 'categories_disabled', 'Las categorías no están configuradas en el servidor.');
                if (typeof body.categoryId !== 'string' || typeof body.active !== 'boolean') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const before = await db.getRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId }).catch(() => null);
                if (!before || !catVisible(before)) return fail(res, 404, 'not_found', 'Categoría no encontrada.');
                if (!catEditable(before)) return fail(res, 403, 'forbidden', 'Esa categoría es común; solo el superadministrador puede editarla.');
                const row = await db.updateRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId, data: { active: body.active } });
                await audit('category_active', 'category', row.$id, body.active ? 'activada' : 'desactivada');
                return res.json({ category: catView(row) });
            }

            case 'deleteCategory': {
                const denied = needAdmin();
                if (denied) return denied;
                if (!CATEGORIES) return fail(res, 503, 'categories_disabled', 'Las categorías no están configuradas en el servidor.');
                if (typeof body.categoryId !== 'string') return fail(res, 400, 'bad_request', 'Falta la categoría.');
                const before = await db.getRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId }).catch(() => null);
                if (!before || !catVisible(before)) return fail(res, 404, 'not_found', 'Categoría no encontrada.');
                if (!catEditable(before)) return fail(res, 403, 'forbidden', 'Esa categoría es común; solo el superadministrador puede editarla.');
                // No se borra una categoria con productos: quedarian huerfanos en el catalogo.
                const used = (await db.listRows({ databaseId: DB, tableId: MENU, queries: [Query.equal('categories', [body.categoryId]), Query.limit(1)] })).rows;
                if (used.length > 0) return fail(res, 409, 'category_in_use', 'La categoría tiene productos. Muévelos o desactívala en su lugar.');
                await db.deleteRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId });
                await audit('category_delete', 'category', body.categoryId, String(before.name || '').slice(0, 60));
                return res.json({ deleted: true });
            }

            case 'listCustomers': {
                // Datos personales: solo administrador, solo campos necesarios, y paginado.
                const denied = needAdmin();
                if (denied) return denied;
                const search = typeof body.query === 'string' ? body.query.trim().slice(0, 60) : '';
                let pool;
                if (MULTI && !scope.global) {
                    // Administrador de tienda: solo clientes que han pedido en su tienda.
                    const recent = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.orderDesc('$createdAt'), Query.limit(100)] })).rows.filter(rowVisible);
                    const ids = [...new Set(recent.map((o) => o.userId).filter(Boolean))].slice(0, 50);
                    const got = await Promise.all(ids.map((id) => users.get({ userId: id }).catch(() => null)));
                    const q = search.toLowerCase();
                    pool = got.filter(Boolean).filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
                } else {
                    pool = (await users.list({ queries: [Query.limit(50)], ...(search ? { search } : {}) })).users;
                }
                const customers = pool
                    .filter((u) => !(u.labels ?? []).some((l) => ['superadmin', 'admin', 'staff', 'driver'].includes(l)))
                    .map((u) => ({ id: u.$id, name: u.name || '(sin nombre)', email: u.email ?? null, active: u.status !== false, createdAt: u.$createdAt ?? null }));
                return res.json({ customers });
            }

            case 'customerOrders': {
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.customerId !== 'string') return fail(res, 400, 'bad_request', 'Falta el cliente.');
                const rows = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('userId', [body.customerId]), Query.orderDesc('$createdAt'), Query.limit(50)] })).rows.filter(rowVisible);
                const out = {
                    orders: rows.map((o) => ({ id: o.$id, status: o.status, total: o.total, paymentMethod: o.paymentMethod || 'cash_on_delivery', paymentStatus: o.paymentStatus ?? null, createdAt: o.$createdAt })),
                    spent: Math.round(rows.filter((o) => o.status === 'delivered').reduce((a, o) => a + Math.round(Number(o.total) * 100), 0)) / 100
                };
                // Las direcciones son datos personales: solo si se piden expresamente, y queda constancia en la auditoria.
                if (body.includeAddresses === true) {
                    out.addresses = [...new Set(rows.map((o) => o.deliveryAddress).filter((a) => typeof a === 'string' && a))].slice(0, 10);
                    await audit('customer_addresses_viewed', 'user', body.customerId, 'Consulta de direcciones');
                }
                return res.json(out);
            }

            case 'setUserStatus': {
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.userId !== 'string') return fail(res, 400, 'bad_request', 'Falta el usuario.');
                const target = await users.get({ userId: body.userId }).catch(() => null);
                if (!target || !canSeeUser(scope, target.labels)) return fail(res, 404, 'not_found', 'Usuario no encontrado.');
                if (actorScope(target.labels).superadmin && !scope.superadmin) return fail(res, 403, 'role_not_allowed', 'No puedes modificar a un superadministrador.');
                const admins = await users.list({ queries: [Query.equal('labels', ['admin']), Query.limit(50)] });
                const otherActiveAdmins = admins.users.filter((u) => u.$id !== body.userId && u.status !== false).length;
                const v = validateUserStatusChange({ actorId: userId, targetId: body.userId, active: body.active, targetLabels: target.labels ?? [], otherActiveAdmins });
                if (!v.ok) return fail(res, v.status, v.code, v.error);
                await users.updateStatus({ userId: body.userId, status: body.active });
                await audit('user_status', 'user', body.userId, body.active ? 'activado' : 'desactivado');
                return res.json({ id: body.userId, active: body.active });
            }

            case 'userHistory': {
                // Historial de acciones sobre/por un usuario visible para el actor.
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.userId !== 'string') return fail(res, 400, 'bad_request', 'Falta el usuario.');
                const target = await users.get({ userId: body.userId }).catch(() => null);
                if (!target || !canSeeUser(scope, target.labels)) return fail(res, 404, 'not_found', 'Usuario no encontrado.');
                if (!AUDIT) return res.json({ enabled: false, entries: [] });
                const rows = (await db.listRows({ databaseId: DB, tableId: AUDIT, queries: [Query.equal('targetId', [body.userId]), Query.orderDesc('$createdAt'), Query.limit(50)] })).rows;
                return res.json({ enabled: true, entries: rows.map((e) => ({ id: e.$id, action: e.action, actorRole: e.actorRole ?? null, summary: e.summary ?? '', at: e.$createdAt })) });
            }

            case 'listAudit': {
                const denied = needGlobal();
                if (denied) return denied;
                if (!AUDIT) return res.json({ enabled: false, entries: [] });
                const rows = (await db.listRows({ databaseId: DB, tableId: AUDIT, queries: [Query.orderDesc('$createdAt'), Query.limit(50)] })).rows;
                return res.json({ enabled: true, entries: rows.map((e) => ({ id: e.$id, action: e.action, actorId: e.actorId, actorRole: e.actorRole ?? null, targetType: e.targetType ?? null, targetId: e.targetId ?? null, summary: e.summary ?? '', at: e.$createdAt })) });
            }

            case 'listUsers': {
                const denied = needAdmin();
                if (denied) return denied;
                const search = typeof body.query === 'string' ? body.query.trim().slice(0, 60) : '';
                const roleFilter = typeof body.role === 'string' ? body.role : '';
                const storeFilter = typeof body.storeId === 'string' && body.storeId ? body.storeId : null;
                const list = await users.list({ queries: [Query.limit(100)], ...(search ? { search } : {}) });
                const out = list.users
                    .filter((u) => canSeeUser(scope, u.labels))
                    .map(userView)
                    .filter((u) => (!roleFilter || u.role === roleFilter) && (!storeFilter || u.storeId === storeFilter));
                return res.json({ users: out, truncated: list.users.length >= 100 });
            }

            case 'createUser': {
                const denied = needAdmin();
                if (denied) return denied;
                const input = body.user && typeof body.user === 'object' ? body.user : {};
                // La tienda se consulta ANTES de validar para que la regla decida con datos del servidor, no del cliente.
                const wantedStore = scope.global ? (typeof input.storeId === 'string' && input.storeId ? input.storeId : null) : scope.storeId;
                let storeInfo = null;
                if (wantedStore && MULTI) { const st = await getStore(wantedStore); storeInfo = st ? { exists: true, active: st.active !== false } : { exists: false }; }
                else if (wantedStore) storeInfo = { exists: wantedStore === DEFAULT_STORE_ID, active: true }; // sin multitienda solo existe la tienda por omision
                const v = validateUserCreate({ scope, input, store: storeInfo });
                if (!v.ok) return fail(res, v.status, v.code, v.error);
                const { name, email, role, storeId } = v.data;
                const dup = await users.list({ queries: [Query.equal('email', [email]), Query.limit(1)] });
                if (dup.users.length > 0) return fail(res, 409, 'email_taken', 'Ese correo ya está registrado.');
                // La contraseña nunca se registra ni se devuelve. Sin contraseña indicada se genera una aleatoria que nadie conoce
                // y la persona establece la suya con el correo de recuperación.
                const password = v.password || `${randomBytes(18).toString('base64url')}aA1!`;
                let created;
                try {
                    created = await users.create({ userId: ID.unique(), email, password, name });
                } catch (e) {
                    if (e && (e.code === 409 || /already exists/i.test(String(e.message || '')))) return fail(res, 409, 'email_taken', 'Ese correo ya está registrado.');
                    if (e && e.code === 400) return fail(res, 422, 'auth_rejected', 'Appwrite rechazó los datos (correo o contraseña no válidos).');
                    throw e;
                }
                // Paso 2: rol + tienda. Si falla, se REVIERTE la cuenta de Auth para no dejar una cuenta a medias.
                try {
                    await users.updateLabels({ userId: created.$id, labels: composeLabels({ currentLabels: [], role, storeId }) });
                } catch (e) {
                    error(`create_user_labels_failed: ${e.message}`);
                    let rolledBack = true;
                    try { await users.delete({ userId: created.$id }); } catch (e2) { rolledBack = false; error(`create_user_rollback_failed id=${created.$id}: ${e2.message}`); }
                    await audit('user_create_failed', 'user', created.$id, rolledBack ? 'revertido' : 'REVERSIÓN FALLIDA: cuenta sin rol, desactívala');
                    if (!rolledBack) { try { await users.updateStatus({ userId: created.$id, status: false }); } catch { /* ya se registró */ } }
                    return fail(res, 500, 'create_user_failed', 'No se pudo asignar el rol. La cuenta se revirtió; inténtalo de nuevo.');
                }
                // El perfil de la app (tabla de usuarios) se crea solo en su primer inicio de sesión; no hay fila que pueda quedar huérfana.
                let recoveryEmailSent = false;
                if (!v.password && RECOVERY_URL) {
                    try {
                        const anon = new Client().setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT).setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID);
                        await new Account(anon).createRecovery({ email, url: RECOVERY_URL });
                        recoveryEmailSent = true;
                    } catch (e) { error(`recovery_email_failed: ${e.message}`); }
                }
                await audit('user_create', 'user', created.$id, `${role}${storeId ? ` @${storeId}` : ''}`);
                return res.json({ user: userView({ ...created, labels: composeLabels({ currentLabels: [], role, storeId }) }), recoveryEmailSent, passwordSetByAdmin: !!v.password });
            }

            case 'updateUser': {
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.userId !== 'string') return fail(res, 400, 'bad_request', 'Falta el usuario.');
                const target = await users.get({ userId: body.userId }).catch(() => null);
                if (!target || !canSeeUser(scope, target.labels)) return fail(res, 404, 'not_found', 'Usuario no encontrado.');
                const input = body.changes && typeof body.changes === 'object' ? body.changes : {};
                let storeInfo = null;
                if (typeof input.storeId === 'string' && input.storeId) { const st = await getStore(input.storeId); storeInfo = st ? { exists: true, active: st.active !== false } : { exists: !MULTI && input.storeId === DEFAULT_STORE_ID, active: true }; }
                const v = validateUserUpdate({ scope, actorId: userId, targetId: body.userId, targetLabels: target.labels ?? [], input, store: storeInfo });
                if (!v.ok) return fail(res, v.status, v.code, v.error);
                // Nunca se deja el sistema sin administrador global.
                if (v.data.role && actorScope(target.labels).role === 'admin' && v.data.role !== 'admin') {
                    const admins = await users.list({ queries: [Query.equal('labels', ['admin']), Query.limit(5)] });
                    if (admins.users.filter((u) => u.$id !== body.userId && u.status !== false).length < 1 && actorScope(target.labels).global) return fail(res, 409, 'last_admin', 'Debe quedar al menos un administrador.');
                }
                if (v.data.name) await users.updateName({ userId: body.userId, name: v.data.name });
                if (v.data.role !== undefined || v.data.storeId !== undefined) {
                    await users.updateLabels({ userId: body.userId, labels: composeLabels({ currentLabels: target.labels ?? [], role: v.role, storeId: v.storeId }) });
                }
                await audit('user_update', 'user', body.userId, `Campos: ${Object.keys(v.data).join(', ') || '-'}${v.data.role ? ` rol=${v.role}` : ''}${v.data.storeId !== undefined ? ` tienda=${v.storeId || '-'}` : ''}`);
                const fresh = await users.get({ userId: body.userId });
                return res.json({ user: userView(fresh) });
            }

            case 'resetPassword': {
                // Envia el correo de recuperacion: el administrador nunca ve ni fija la contraseña.
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.userId !== 'string') return fail(res, 400, 'bad_request', 'Falta el usuario.');
                const target = await users.get({ userId: body.userId }).catch(() => null);
                if (!target || !canSeeUser(scope, target.labels)) return fail(res, 404, 'not_found', 'Usuario no encontrado.');
                if (actorScope(target.labels).superadmin && !scope.superadmin) return fail(res, 403, 'role_not_allowed', 'No puedes modificar a un superadministrador.');
                if (!RECOVERY_URL) return fail(res, 503, 'recovery_disabled', 'Falta configurar RECOVERY_URL en el servidor.');
                const anon = new Client().setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT).setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID);
                try { await new Account(anon).createRecovery({ email: target.email, url: RECOVERY_URL }); } catch (e) { error(`recovery_failed: ${e.message}`); return fail(res, 502, 'recovery_failed', 'No se pudo enviar el correo de recuperación.'); }
                await audit('user_password_reset', 'user', body.userId, 'correo de recuperación enviado');
                return res.json({ sent: true });
            }

            case 'listStores': {
                // Superadministrador: todas. Administrador/personal de tienda: solo la suya.
                if (!MULTI) return res.json({ enabled: false, stores: [] });
                if (scope.global) {
                    const rows = (await db.listRows({ databaseId: DB, tableId: STORES, queries: [Query.orderAsc('name'), Query.limit(100)] })).rows;
                    return res.json({ enabled: true, stores: rows.map(storeView) });
                }
                const mine = scope.storeId ? await getStore(scope.storeId) : null;
                return res.json({ enabled: true, stores: mine ? [storeView(mine)] : [] });
            }

            case 'saveStore': {
                if (!MULTI) return fail(res, 503, 'stores_disabled', 'Falta STORES_TABLE_ID en el servidor.');
                const denied = needAdmin();
                if (denied) return denied;
                const editing = typeof body.storeId === 'string' && body.storeId !== '';
                let v = validateStoreInput(body.store, { partial: editing });
                // V16: porcentajes de reparto financiero de la tienda. Solo el superadministrador los define.
                const fin = {};
                for (const k of ['platformPct', 'driverPct']) {
                    const raw = body.store && body.store[k];
                    if (raw === undefined || raw === null) continue;
                    if (!scope.superadmin) return fail(res, 403, 'forbidden', 'Solo el superadministrador define comisiones.');
                    const n = Number(raw);
                    if (!Number.isFinite(n) || n < 0 || n > 100) return fail(res, 422, 'bad_store', `Campo inválido: ${k} (0–100).`);
                    fin[k] = n;
                }
                if (!v.ok && v.error === 'No hay cambios.' && Object.keys(fin).length) v = { ok: true, data: {} };
                if (!v.ok) return fail(res, 422, v.code, v.error);
                Object.assign(v.data, fin);
                if (editing) {
                    if (!canAccessStore(scope, body.storeId)) return fail(res, 403, 'store_forbidden', 'No puedes editar esa tienda.');
                    const before = await getStore(body.storeId);
                    if (!before) return fail(res, 404, 'not_found', 'Tienda no encontrada.');
                    // El administrador de tienda no puede (des)activar su propia tienda; solo el superadministrador.
                    if (!scope.global && v.data.active !== undefined) return fail(res, 403, 'forbidden', 'Solo el superadministrador activa o desactiva tiendas.');
                    const row = await db.updateRow({ databaseId: DB, tableId: STORES, rowId: body.storeId, data: v.data });
                    await audit('store_update', 'store', body.storeId, Object.keys(v.data).join(', '));
                    return res.json({ store: storeView(row) });
                }
                const denied2 = needSuper();
                if (denied2) return denied2;
                const id = typeof body.newStoreId === 'string' && validStoreId(body.newStoreId) ? body.newStoreId : ID.unique();
                const row = await db.createRow({ databaseId: DB, tableId: STORES, rowId: id, data: { active: true, closed: false, ...v.data } }).catch((e) => {
                    if (e && (e.code === 409 || /already exists/i.test(String(e.message || '')))) return null;
                    throw e;
                });
                if (!row) return fail(res, 409, 'store_exists', 'Ya existe una tienda con ese identificador.');
                await audit('store_create', 'store', row.$id, String(v.data.name).slice(0, 60));
                return res.json({ store: storeView(row) });
            }

            case 'setStoreActive': {
                if (!MULTI) return fail(res, 503, 'stores_disabled', 'Falta STORES_TABLE_ID en el servidor.');
                const denied = needSuper();
                if (denied) return denied;
                if (typeof body.storeId !== 'string' || typeof body.active !== 'boolean') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const before = await getStore(body.storeId);
                if (!before) return fail(res, 404, 'not_found', 'Tienda no encontrada.');
                const row = await db.updateRow({ databaseId: DB, tableId: STORES, rowId: body.storeId, data: { active: body.active } });
                await audit('store_active', 'store', body.storeId, body.active ? 'activada' : 'desactivada');
                return res.json({ store: storeView(row) });
            }


            // ---------------------------------------------------------------- V16: finanzas y alta de repartidores
            case 'financeReport': {
                // Comision de plataforma, ingreso de tienda y ganancia de repartidores de pedidos ENTREGADOS. Solo calcula (no mueve dinero).
                const denied = needAdmin();
                if (denied) return denied;
                const range = parseDateRange(body);
                if (!range.ok) return fail(res, 400, range.code, range.error);
                const { orders, truncated } = await loadOrders(range);
                const storeRows = MULTI ? (await db.listRows({ databaseId: DB, tableId: STORES, queries: [Query.limit(100)] })).rows : [];
                const cfgFor = (o) => {
                    const st = storeRows.find((x) => x.$id === storeOf(o));
                    const pick = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
                    return { platformPct: pick(st && st.platformPct, PLATFORM_PCT), driverPct: pick(st && st.driverPct, DRIVER_PCT) };
                };
                const f = aggregateFinance(orders.map((o) => ({ ...o, storeId: storeOf(o) })), cfgFor);
                return res.json({ finance: f, config: { platformPct: PLATFORM_PCT, driverPct: DRIVER_PCT, perStoreOverrides: storeRows.filter((x) => typeof x.platformPct === 'number' || typeof x.driverPct === 'number').map((x) => x.$id) }, truncated, transfers: 'not_implemented' });
            }

            case 'listDriverApplications': {
                const denied = needAdmin();
                if (denied) return denied;
                const all = await users.list({ queries: [Query.equal('labels', [DRIVER_PENDING_LABEL]), Query.limit(100)] });
                const mine = all.users.filter((u) => {
                    if (!MULTI || scope.global) return true;
                    return (storeFromLabelsV(u.labels) || DEFAULT_STORE_ID) === scope.storeId;
                });
                return res.json({ applications: mine.map((u) => ({ id: u.$id, name: u.name, email: u.email ?? null, storeId: storeFromLabelsV(u.labels) || DEFAULT_STORE_ID, phone: u.prefs?.driverPhone ?? null, vehicle: u.prefs?.driverVehicle ?? null, note: u.prefs?.driverNote ?? null, appliedAt: u.prefs?.driverAppliedAt ?? null, state: driverAccountState(u.labels, u.status !== false) })) });
            }

            case 'reviewDriver': {
                // Aprobar convierte la solicitud en repartidor (etiqueta driver + tienda). Rechazar la elimina. Nunca otorga otros roles.
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.userId !== 'string' || typeof body.approve !== 'boolean') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const target = await users.get({ userId: body.userId }).catch(() => null);
                if (!target || !(target.labels ?? []).includes(DRIVER_PENDING_LABEL)) return fail(res, 404, 'not_found', 'Solicitud no encontrada.');
                const requested = storeFromLabelsV(target.labels) || DEFAULT_STORE_ID;
                if (MULTI && !scope.global && requested !== scope.storeId) return fail(res, 404, 'not_found', 'Solicitud no encontrada.');
                const base = (target.labels ?? []).filter((l) => l !== DRIVER_PENDING_LABEL);
                if (!body.approve) {
                    await users.updateLabels({ userId: body.userId, labels: base.filter((l) => !/^sts/.test(l) || base.some((x) => ['admin', 'staff', 'driver'].includes(x))) });
                    await audit('driver_rejected', 'user', body.userId, 'solicitud rechazada');
                    return res.json({ id: body.userId, state: 'rejected' });
                }
                const storeId = MULTI ? requested : null;
                if (MULTI) {
                    const st = await getStore(storeId);
                    if (!st) return fail(res, 422, 'store_not_found', 'La tienda solicitada no existe.');
                    if (st.active === false) return fail(res, 422, 'store_inactive', 'La tienda está inactiva.');
                }
                const labels = [...new Set([...base, 'driver', ...(storeId ? [storeLabel(storeId)] : [])])];
                await users.updateLabels({ userId: body.userId, labels });
                await audit('driver_approved', 'user', body.userId, storeId ? `tienda ${storeId}` : 'aprobado');
                return res.json({ id: body.userId, state: 'approved', storeId });
            }

            case 'setRole': {
                // V15: herramienta heredada, solo alcance global. El panel usa `updateUser` (valida rol y tienda).
                const denied = needGlobal();
                if (denied) return denied;
                if (typeof body.userId !== 'string') return fail(res, 400, 'bad_request', 'Falta el usuario.');
                const target = await users.get({ userId: body.userId }).catch(() => null);
                if (!target) return fail(res, 404, 'not_found', 'Usuario no encontrado.');
                const targetLabels = target.labels ?? [];
                const change = validateRoleChange({ actorId: userId, targetId: body.userId, labels: body.labels, targetCurrent: targetLabels });
                if (!change.ok) return fail(res, 422, change.code, change.error);
                // Nunca se deja el sistema sin administradores.
                if (targetLabels.includes('admin') && !change.labels.includes('admin')) {
                    const admins = await users.list({ queries: [Query.equal('labels', ['admin']), Query.limit(5)] });
                    if (admins.users.length <= 1) return fail(res, 409, 'last_admin', 'Debe quedar al menos un administrador.');
                }
                await users.updateLabels({ userId: body.userId, labels: change.labels });
                await audit('role_change', 'user', body.userId, `Roles: ${change.labels.filter((l) => ['admin', 'staff', 'driver'].includes(l)).join(',') || 'cliente'}`);
                return res.json({ id: body.userId, labels: change.labels.filter((l) => ['admin', 'staff', 'driver'].includes(l)) });
            }

            default:
                return fail(res, 400, 'bad_action', 'Acción no válida.');
        }
    } catch (e) {
        error(e.message);
        return fail(res, 500, 'internal', 'No se pudo completar la operación.');
    }
};
