import { createHash } from 'node:crypto';
import { Client, ID, Query, TablesDB, Users } from 'node-appwrite';
import {
    DEFAULT_LOW_STOCK, aggregateReport, isLowStock, parseDateRange, planStockAdjust, stockOf, toCsv,
    validateProductInput, validateRoleChange, makeInventory, buildDashboard, validateCategoryInput, buildAuditEntry, validateUserStatusChange,
    ACTIVE_DELIVERY, IN_TRANSIT, driverState
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
const AUDIT = process.env.AUDIT_TABLE_ID; // opcional: registro de acciones administrativas
const MAX_ACTIVE_PER_DRIVER = Number(process.env.MAX_ACTIVE_PER_DRIVER ?? 3);
const MAX_REPORT_ORDERS = 2000;
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
        const isAdmin = labels.includes('admin');
        const isStaff = isAdmin || labels.includes('staff');
        if (!isStaff) return fail(res, 403, 'forbidden', 'Solo personal autorizado.');
        const needAdmin = () => (isAdmin ? null : fail(res, 403, 'forbidden', 'Solo administradores.'));
        const inventory = makeInventory({ db, DB, MENU, MOVES, Query, hash });

        /** Registro de acciones administrativas importantes (mejor esfuerzo; siempre queda tambien en el log de la Function). */
        const audit = async (act, targetType, targetId, summary) => {
            log(`audit action=${act} target=${targetType}:${targetId} actor=${userId}`);
            if (!AUDIT) return;
            try { await db.createRow({ databaseId: DB, tableId: AUDIT, rowId: ID.unique(), data: buildAuditEntry({ actorId: userId, actorRole: isAdmin ? 'admin' : 'staff', action: act, targetType, targetId, summary }) }); } catch (e) { error(`audit_failed: ${e.message}`); }
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
            const deliveredIds = orders.filter((o) => o.status === 'delivered').map((o) => o.$id);
            const itemsByOrder = {};
            for (let i = 0; i < deliveredIds.length && ITEMS; i += 50) {
                const rows = (await db.listRows({ databaseId: DB, tableId: ITEMS, queries: [Query.equal('orderId', deliveredIds.slice(i, i + 50)), Query.limit(500)] })).rows;
                for (const r of rows) (itemsByOrder[r.orderId] ??= []).push(r);
            }
            return { orders, itemsByOrder, truncated: orders.length >= MAX_REPORT_ORDERS };
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
                return res.json({ admin: isAdmin, staff: true, inventoryEnabled: !!MOVES });

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
                const list = rows.map(productView).filter((p) => !q || p.name.toLowerCase().includes(q));
                return res.json({ products: list, lowStock: list.filter((p) => p.lowStock).length, inventoryEnabled: !!MOVES, truncated });
            }

            case 'listCategories': {
                if (!CATEGORIES) return res.json({ categories: [] });
                const rows = (await db.listRows({ databaseId: DB, tableId: CATEGORIES, queries: [Query.limit(100)] })).rows;
                return res.json({ categories: rows.map((c) => ({ id: c.$id, name: c.name, description: c.description ?? '', active: c.active !== false })) });
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
                }
                if (editing) {
                    const before = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId }).catch(() => null);
                    if (!before) return fail(res, 404, 'not_found', 'Producto no encontrado.');
                    // El stock no se cambia por aqui (usa adjustStock para que quede historial y sea atomico).
                    delete v.data.stock;
                    const row = await db.updateRow({ databaseId: DB, tableId: MENU, rowId: body.productId, data: v.data });
                    await audit('product_update', 'product', body.productId, `Campos: ${Object.keys(v.data).join(', ')}`);
                    return res.json({ product: productView(row) });
                }
                const initialStock = body.product && body.product.stock !== undefined ? v.data.stock : null;
                const data = { ...v.data, available: v.data.available !== false, stock: initialStock ?? null };
                const row = await db.createRow({ databaseId: DB, tableId: MENU, rowId: ID.unique(), data });
                await audit('product_create', 'product', row.$id, String(v.data.name || '').slice(0, 80));
                if (typeof initialStock === 'number') await logMove({ menuId: row.$id, orderId: 'manual', type: 'initial', quantity: initialStock, delta: initialStock, reason: 'initial', actorId: userId });
                return res.json({ product: productView(row) });
            }

            case 'setProductAvailability': {
                if (typeof body.productId !== 'string' || typeof body.available !== 'boolean') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const exists = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId }).catch(() => null);
                if (!exists) return fail(res, 404, 'not_found', 'Producto no encontrado.');
                const row = await db.updateRow({ databaseId: DB, tableId: MENU, rowId: body.productId, data: { available: body.available } });
                await audit('product_availability', 'product', body.productId, body.available ? 'activado' : 'desactivado');
                return res.json({ product: productView(row) });
            }

            case 'adjustStock': {
                if (!MOVES) return fail(res, 503, 'inventory_disabled', 'El inventario no está configurado en el servidor.');
                if (typeof body.productId !== 'string') return fail(res, 400, 'bad_request', 'Falta el producto.');
                const product = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId }).catch(() => null);
                if (!product) return fail(res, 404, 'not_found', 'Producto no encontrado.');
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
                await logMove({ menuId: body.productId, orderId: 'manual', type: 'adjust', quantity: Math.abs(plan.delta), delta: plan.delta, reason: reason || 'manual', actorId: userId }, key);
                const row = await db.getRow({ databaseId: DB, tableId: MENU, rowId: body.productId });
                await audit('stock_adjust', 'product', body.productId, `delta ${plan.delta} (${reason || 'manual'})`);
                return res.json({ product: productView(row) });
            }

            case 'stockMovements': {
                if (!MOVES) return res.json({ movements: [], enabled: false });
                const queries = [Query.orderDesc('$createdAt'), Query.limit(50)];
                if (typeof body.productId === 'string') queries.unshift(Query.equal('menuId', body.productId));
                const rows = (await db.listRows({ databaseId: DB, tableId: MOVES, queries })).rows;
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
                const rows = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries })).rows;
                return res.json({
                    truncated: rows.length >= 100,
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
                const deliveredIds = orders.filter((o) => o.status === 'delivered').map((o) => o.$id);
                const itemsByOrder = {};
                for (let i = 0; i < deliveredIds.length && ITEMS; i += 50) {
                    const rows = (await db.listRows({ databaseId: DB, tableId: ITEMS, queries: [Query.equal('orderId', deliveredIds.slice(i, i + 50)), Query.limit(500)] })).rows;
                    for (const r of rows) (itemsByOrder[r.orderId] ??= []).push(r);
                }
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
                const denied = needAdmin();
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
                const drvUsers = await users.list({ queries: [Query.equal('labels', ['driver']), Query.limit(100)] });
                const active = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('status', ACTIVE_DELIVERY), Query.limit(200)] })).rows;
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
                    if (!before) return fail(res, 404, 'not_found', 'Categoría no encontrada.');
                    const row = await db.updateRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId, data: v.data });
                    await audit('category_update', 'category', row.$id, Object.keys(v.data).join(', '));
                    return res.json({ category: { id: row.$id, name: row.name, description: row.description ?? '', active: row.active !== false } });
                }
                const row = await db.createRow({ databaseId: DB, tableId: CATEGORIES, rowId: ID.unique(), data: { description: '', ...v.data } });
                await audit('category_create', 'category', row.$id, String(v.data.name).slice(0, 60));
                return res.json({ category: { id: row.$id, name: row.name, description: row.description ?? '', active: row.active !== false } });
            }

            case 'setCategoryActive': {
                const denied = needAdmin();
                if (denied) return denied;
                if (!CATEGORIES) return fail(res, 503, 'categories_disabled', 'Las categorías no están configuradas en el servidor.');
                if (typeof body.categoryId !== 'string' || typeof body.active !== 'boolean') return fail(res, 400, 'bad_request', 'Datos incompletos.');
                const before = await db.getRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId }).catch(() => null);
                if (!before) return fail(res, 404, 'not_found', 'Categoría no encontrada.');
                const row = await db.updateRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId, data: { active: body.active } });
                await audit('category_active', 'category', row.$id, body.active ? 'activada' : 'desactivada');
                return res.json({ category: { id: row.$id, name: row.name, description: row.description ?? '', active: row.active !== false } });
            }

            case 'deleteCategory': {
                const denied = needAdmin();
                if (denied) return denied;
                if (!CATEGORIES) return fail(res, 503, 'categories_disabled', 'Las categorías no están configuradas en el servidor.');
                if (typeof body.categoryId !== 'string') return fail(res, 400, 'bad_request', 'Falta la categoría.');
                const before = await db.getRow({ databaseId: DB, tableId: CATEGORIES, rowId: body.categoryId }).catch(() => null);
                if (!before) return fail(res, 404, 'not_found', 'Categoría no encontrada.');
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
                const list = await users.list({ queries: [Query.limit(50)], ...(search ? { search } : {}) });
                const customers = list.users
                    .filter((u) => !(u.labels ?? []).some((l) => ['admin', 'staff', 'driver'].includes(l)))
                    .map((u) => ({ id: u.$id, name: u.name || '(sin nombre)', email: u.email ?? null, active: u.status !== false, createdAt: u.$createdAt ?? null }));
                return res.json({ customers });
            }

            case 'customerOrders': {
                const denied = needAdmin();
                if (denied) return denied;
                if (typeof body.customerId !== 'string') return fail(res, 400, 'bad_request', 'Falta el cliente.');
                const rows = (await db.listRows({ databaseId: DB, tableId: ORDERS, queries: [Query.equal('userId', [body.customerId]), Query.orderDesc('$createdAt'), Query.limit(50)] })).rows;
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
                if (!target) return fail(res, 404, 'not_found', 'Usuario no encontrado.');
                const admins = await users.list({ queries: [Query.equal('labels', ['admin']), Query.limit(50)] });
                const otherActiveAdmins = admins.users.filter((u) => u.$id !== body.userId && u.status !== false).length;
                const v = validateUserStatusChange({ actorId: userId, targetId: body.userId, active: body.active, targetLabels: target.labels ?? [], otherActiveAdmins });
                if (!v.ok) return fail(res, v.status, v.code, v.error);
                await users.updateStatus({ userId: body.userId, status: body.active });
                await audit('user_status', 'user', body.userId, body.active ? 'activado' : 'desactivado');
                return res.json({ id: body.userId, active: body.active });
            }

            case 'listAudit': {
                const denied = needAdmin();
                if (denied) return denied;
                if (!AUDIT) return res.json({ enabled: false, entries: [] });
                const rows = (await db.listRows({ databaseId: DB, tableId: AUDIT, queries: [Query.orderDesc('$createdAt'), Query.limit(50)] })).rows;
                return res.json({ enabled: true, entries: rows.map((e) => ({ id: e.$id, action: e.action, actorId: e.actorId, actorRole: e.actorRole ?? null, targetType: e.targetType ?? null, targetId: e.targetId ?? null, summary: e.summary ?? '', at: e.$createdAt })) });
            }

            case 'listUsers': {
                const denied = needAdmin();
                if (denied) return denied;
                const search = typeof body.query === 'string' ? body.query.trim().slice(0, 60) : '';
                const list = await users.list({ queries: [Query.limit(50)], ...(search ? { search } : {}) });
                return res.json({ users: list.users.map((u) => ({ id: u.$id, name: u.name || '(sin nombre)', email: u.email ?? null, labels: (u.labels ?? []).filter((l) => ['admin', 'staff', 'driver'].includes(l)) })) });
            }

            case 'setRole': {
                const denied = needAdmin();
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
