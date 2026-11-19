// V15: usuarios, roles, multitienda, aislamiento e inventario por tienda. SIMULACION en memoria (no es Appwrite real).
import { store } from 'node-appwrite';
for (const [k, v] of Object.entries({ DATABASE_ID: 'db', ORDERS_TABLE_ID: 'orders', ORDER_ITEMS_TABLE_ID: 'items', MENU_TABLE_ID: 'menu', INVENTORY_MOVES_TABLE_ID: 'moves', CATEGORIES_TABLE_ID: 'cats', AUDIT_TABLE_ID: 'audit', AUTO_ASSIGN_DRIVER: 'false', CUSTOMIZATIONS_TABLE_ID: 'cust', MENU_CUSTOMIZATIONS_TABLE_ID: 'rel', ORDER_EVENTS_TABLE_ID: 'events', STORES_TABLE_ID: 'stores', RECOVERY_URL: 'https://equipo.github.io/delivery/recuperar.html' })) process.env[k] = v;
const createOrder = (await import('./create-order/src/main.js')).default;
const ops = (await import('./update-order-status/src/main.js')).default;
const admin = (await import('./admin-api/src/main.js')).default;
const mk = (user, body) => ({ req: { headers: user ? { 'x-appwrite-user-id': user, 'x-appwrite-key': 'k' } : {}, bodyJson: body }, res: { json: (b, s = 200) => ({ s, b }) }, log(){}, error(){} });
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FALLA'), name, cond ? '' : JSON.stringify(extra)); };
const adm = (u, body) => admin(mk(u, body));
const labelsOf = (id) => store.labels[id] ?? [];

// ---- Datos base (los que el servidor realmente usaria: tiendas, productos por tienda, cuentas con etiquetas).
store.stores.push(
  { $id: 'main', name: 'Matriz', active: true, closed: false },
  { $id: 'sA', name: 'Sucursal A', active: true, closed: false, latitude: 19.5, longitude: -99.2, deliveryRadiusKm: 5, deliveryFee: 12, coupons: 'AAA10:percent:10:0' },
  { $id: 'sB', name: 'Sucursal B', active: true, closed: false, deliveryFee: 30 },
  { $id: 'sOff', name: 'Cerrada', active: false },
  { $id: 'sShut', name: 'Cierre manual', active: true, closed: true }
);
store.menu.push(
  { $id: 'pA', name: 'Burger A', price: 10, stock: 5, storeId: 'sA' },
  { $id: 'pB', name: 'Burger B', price: 20, stock: 5, storeId: 'sB' },
  { $id: 'pL', name: 'Legado', price: 7, stock: 9 },                 // V14: sin storeId => tienda "main"
  { $id: 'pShut', name: 'Shut', price: 5, storeId: 'sShut' }
);
store.labels = {
  sup: ['superadmin'], adminA: ['admin', 'stsA'], adminB: ['admin', 'stsB'], legacyAdmin: ['admin'],
  staffA: ['staff', 'stsA'], staffB: ['staff', 'stsB'], legacyStaff: ['staff'],
  drvA: ['driver', 'stsA'], drvB: ['driver', 'stsB'], legacyDrv: ['driver'], cust1: [], cust2: []
};
store.names = { sup: 'Super', adminA: 'Admin A', adminB: 'Admin B', staffA: 'Staff A', staffB: 'Staff B', drvA: 'Rep A', drvB: 'Rep B', cust1: 'Cliente 1', cust2: 'Cliente 2' };
const addr = { line: 'Av. Reforma 123, Centro', label: 'home', latitude: 19.5, longitude: -99.2 };
let n = 0;
const order = (user, storeId, items, extra = {}) => createOrder(mk(user, { clientRequestId: `req15_${++n}_xxxxxxxx`, storeId, address: addr, contact: { phone: '55 1234 5678' }, items, ...extra }));

// =============================================================== 1) USUARIOS: creacion
let r = await adm(null, { action: 'createUser', user: {} }); check('crear usuario sin sesión -> 401', r.s === 401, r);
r = await adm('cust1', { action: 'createUser', user: { name: 'X Y', email: 'x@y.com', role: 'staff', storeId: 'sA' } }); check('un cliente no crea usuarios -> 403', r.s === 403, r);
r = await adm('staffA', { action: 'createUser', user: { name: 'X Y', email: 'x@y.com', role: 'driver', storeId: 'sA' } }); check('el personal no crea usuarios -> 403', r.s === 403, r);

r = await adm('sup', { action: 'createUser', user: { name: 'Ana Admin', email: 'Ana.Admin@Ejemplo.com', role: 'admin', storeId: 'sA' } });
const anaId = r.b.user && r.b.user.id;
check('superadmin crea administrador de tienda (etiquetas admin + tienda)', r.s === 200 && r.b.user.role === 'admin' && r.b.user.storeId === 'sA' && labelsOf(anaId).includes('admin') && labelsOf(anaId).includes('stsA'), r);
check('el correo se guarda en minúsculas', store.emails[anaId] === 'ana.admin@ejemplo.com');
check('sin contraseña se envía correo de recuperación', r.b.recoveryEmailSent === true && store.recoveries.length === 1 && store.recoveries[0].email === 'ana.admin@ejemplo.com');
check('la respuesta nunca incluye contraseña', !JSON.stringify(r.b).toLowerCase().includes('password') || r.b.passwordSetByAdmin === false, r.b);
r = await adm('sup', { action: 'createUser', user: { name: 'Ana Dos', email: 'ana.admin@ejemplo.com', role: 'staff', storeId: 'sA' } }); check('correo duplicado -> 409 email_taken', r.s === 409 && r.b.code === 'email_taken', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Super 2', email: 's2@ejemplo.com', role: 'superadmin' } }); check('nadie crea superadministradores desde la app -> 403', r.s === 403 && r.b.code === 'role_not_allowed', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Sin Tienda', email: 'st@ejemplo.com', role: 'staff' } }); check('encargado sin tienda -> 400 store_required', r.s === 400 && r.b.code === 'store_required', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Rep Sin', email: 'rs@ejemplo.com', role: 'driver' } }); check('repartidor sin tienda -> 400 store_required', r.s === 400 && r.b.code === 'store_required', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Tienda Falsa', email: 'tf@ejemplo.com', role: 'staff', storeId: 'noExiste' } }); check('tienda inexistente -> 422 store_not_found', r.s === 422 && r.b.code === 'store_not_found', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Tienda Off', email: 'to@ejemplo.com', role: 'staff', storeId: 'sOff' } }); check('tienda inactiva -> 422 store_inactive', r.s === 422 && r.b.code === 'store_inactive', r);
r = await adm('sup', { action: 'createUser', user: { name: 'A', email: 'a@ejemplo.com', role: 'staff', storeId: 'sA' } }); check('nombre demasiado corto -> 400', r.s === 400 && r.b.code === 'bad_name', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Bad Mail', email: 'no-es-correo', role: 'staff', storeId: 'sA' } }); check('correo inválido -> 400', r.s === 400 && r.b.code === 'bad_email', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Rol Raro', email: 'rr@ejemplo.com', role: 'dios', storeId: 'sA' } }); check('rol inválido -> 400', r.s === 400 && r.b.code === 'bad_role', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Pass Corta', email: 'pc@ejemplo.com', role: 'staff', storeId: 'sA', password: '123' } }); check('contraseña corta -> 400 weak_password', r.s === 400 && r.b.code === 'weak_password', r);
r = await adm('sup', { action: 'createUser', user: { name: 'Con Clave', email: 'ck@ejemplo.com', role: 'staff', storeId: 'sA', password: 'ClaveSegura#2026' } });
check('con contraseña indicada: no envía recuperación y no la devuelve', r.s === 200 && r.b.passwordSetByAdmin === true && r.b.recoveryEmailSent === false && !JSON.stringify(r.b).includes('ClaveSegura'), r);

// administrador de tienda: solo su tienda, sin elevar privilegios
r = await adm('adminA', { action: 'createUser', user: { name: 'Enc Alfa', email: 'enc.a@ejemplo.com', role: 'staff' } });
check('admin de tienda crea encargado: toma SU tienda aunque no la mande', r.s === 200 && r.b.user.storeId === 'sA' && r.b.user.role === 'staff', r);
r = await adm('adminA', { action: 'createUser', user: { name: 'Rep Alfa', email: 'rep.a@ejemplo.com', role: 'driver', storeId: 'sA' } }); check('admin de tienda crea repartidor', r.s === 200 && r.b.user.role === 'driver', r);
r = await adm('adminA', { action: 'createUser', user: { name: 'Cli Alfa', email: 'cli.a@ejemplo.com', role: 'customer' } }); check('admin de tienda crea cliente', r.s === 200 && r.b.user.role === 'customer' && labelsOf(r.b.user.id).every((l) => l === 'stsA'), r);
r = await adm('adminA', { action: 'createUser', user: { name: 'Intruso', email: 'in@ejemplo.com', role: 'staff', storeId: 'sB' } }); check('admin de tienda NO crea usuarios en otra tienda -> 403', r.s === 403 && r.b.code === 'store_forbidden', r);
r = await adm('adminA', { action: 'createUser', user: { name: 'Otro Admin', email: 'oa@ejemplo.com', role: 'admin', storeId: 'sA' } }); check('admin de tienda NO crea administradores -> 403', r.s === 403 && r.b.code === 'role_not_allowed', r);
r = await adm('adminA', { action: 'createUser', user: { name: 'Super X', email: 'sx@ejemplo.com', role: 'superadmin' } }); check('admin de tienda NO crea superadmins -> 403', r.s === 403, r);

// reversion si falla el segundo paso
const before = Object.keys(store.labels).length;
store.failLabels = true;
r = await adm('sup', { action: 'createUser', user: { name: 'Se Revierte', email: 'rev@ejemplo.com', role: 'staff', storeId: 'sA' } });
store.failLabels = false;
check('si falla asignar rol -> 500 y la cuenta de Auth se revierte (sin cuentas a medias)', r.s === 500 && r.b.code === 'create_user_failed' && Object.keys(store.labels).length === before && !Object.values(store.emails).includes('rev@ejemplo.com'), [r, Object.keys(store.labels).length, before]);
r = await adm('sup', { action: 'createUser', user: { name: 'Se Revierte', email: 'rev@ejemplo.com', role: 'staff', storeId: 'sA' } }); check('tras la reversión el mismo correo se puede volver a usar', r.s === 200, r);
store.failRecovery = true;
r = await adm('sup', { action: 'createUser', user: { name: 'Sin Smtp', email: 'smtp@ejemplo.com', role: 'staff', storeId: 'sA' } }); store.failRecovery = false;
check('si falla el correo de recuperación la cuenta queda creada y se avisa', r.s === 200 && r.b.recoveryEmailSent === false, r);

// =============================================================== 2) USUARIOS: consulta, edicion, estado
r = await adm('adminA', { action: 'listUsers' });
check('admin A solo ve usuarios de su tienda (ningún B ni superadmin)', r.s === 200 && r.b.users.length > 0 && r.b.users.every((u) => u.storeId === 'sA') && !r.b.users.some((u) => ['adminB', 'staffB', 'drvB', 'sup'].includes(u.id)), r.b.users.map((u) => u.id));
r = await adm('sup', { action: 'listUsers' }); check('superadmin ve usuarios de todas las tiendas', r.b.users.some((u) => u.id === 'adminB') && r.b.users.some((u) => u.id === 'adminA'), r.b.users.length);
r = await adm('sup', { action: 'listUsers', storeId: 'sB' }); check('filtro por tienda', r.b.users.length > 0 && r.b.users.every((u) => u.storeId === 'sB'), r.b.users);
r = await adm('sup', { action: 'listUsers', role: 'driver' }); check('filtro por rol', r.b.users.length > 0 && r.b.users.every((u) => u.role === 'driver'), r.b.users);
r = await adm('sup', { action: 'listUsers', query: 'Ana' }); check('búsqueda por nombre', r.b.users.some((u) => u.id === anaId), r.b.users);

const encA = Object.keys(store.emails).find((id) => store.emails[id] === 'enc.a@ejemplo.com');
r = await adm('adminA', { action: 'updateUser', userId: encA, changes: { name: 'Encargada Alfa' } }); check('admin A edita nombre de su empleado', r.s === 200 && store.names[encA] === 'Encargada Alfa', r);
r = await adm('adminA', { action: 'updateUser', userId: encA, changes: { role: 'driver' } }); check('admin A cambia rol de empleado (staff->driver) y conserva tienda', r.s === 200 && r.b.user.role === 'driver' && r.b.user.storeId === 'sA', r);
r = await adm('adminA', { action: 'updateUser', userId: encA, changes: { role: 'admin' } }); check('admin A NO asciende a admin -> 403', r.s === 403 && r.b.code === 'role_not_allowed', r);
r = await adm('adminA', { action: 'updateUser', userId: encA, changes: { storeId: 'sB' } }); check('admin A NO cambia a un usuario de tienda -> 403', r.s === 403 && r.b.code === 'store_forbidden', r);
r = await adm('adminA', { action: 'updateUser', userId: 'staffB', changes: { name: 'Hack Hack' } }); check('admin A no ve ni edita usuarios de B (404)', r.s === 404, r);
r = await adm('adminA', { action: 'updateUser', userId: 'adminA', changes: { role: 'staff' } }); check('nadie cambia su propio rol -> 403', r.s === 403 && r.b.code === 'self_role_change', r);
r = await adm('adminA', { action: 'updateUser', userId: 'sup', changes: { name: 'Hack Hack' } }); check('admin A no ve al superadmin (404)', r.s === 404, r);
r = await adm('sup', { action: 'updateUser', userId: encA, changes: { storeId: 'sB' } }); check('superadmin mueve un usuario a otra tienda', r.s === 200 && r.b.user.storeId === 'sB' && !labelsOf(encA).includes('stsA'), r);
r = await adm('adminA', { action: 'updateUser', userId: encA, changes: { name: 'Ya no es mío' } }); check('tras el cambio, admin A ya no lo ve (404)', r.s === 404, r);
r = await adm('sup', { action: 'updateUser', userId: encA, changes: { storeId: 'sOff' } }); check('no se asigna a una tienda inactiva -> 422', r.s === 422 && r.b.code === 'store_inactive', r);
r = await adm('sup', { action: 'updateUser', userId: encA, changes: { storeId: null } }); check('un repartidor no puede quedarse sin tienda -> 400', r.s === 400 && r.b.code === 'store_required', r);
r = await adm('sup', { action: 'updateUser', userId: 'cust1', changes: { role: 'superadmin' } }); check('superadmin no concede superadmin desde la app -> 403', r.s === 403, r);
r = await adm('sup', { action: 'setRole', userId: 'cust1', labels: ['superadmin'] }); check('setRole heredado tampoco concede superadmin -> 422', r.s === 422 && r.b.code === 'role_not_allowed', r);
r = await adm('adminA', { action: 'setRole', userId: 'cust1', labels: ['admin'] }); check('setRole heredado es solo global: admin de tienda -> 403', r.s === 403, r);

const staffAid = 'staffA';
r = await adm('adminA', { action: 'setUserStatus', userId: staffAid, active: false }); check('admin A desactiva a su empleado', r.s === 200 && store.status[staffAid] === false, r);
r = await adm('adminA', { action: 'setUserStatus', userId: staffAid, active: true }); check('admin A reactiva a su empleado', r.s === 200 && store.status[staffAid] === true, r);
r = await adm('adminA', { action: 'setUserStatus', userId: 'drvB', active: false }); check('admin A no desactiva usuarios de B (404)', r.s === 404, r);
r = await adm('adminA', { action: 'setUserStatus', userId: 'adminA', active: false }); check('nadie se desactiva a sí mismo -> 409', r.s === 409, r);
r = await adm('adminA', { action: 'resetPassword', userId: staffAid }); check('restablecer contraseña envía correo (nunca muestra la contraseña)', r.s === 200 && r.b.sent === true && store.recoveries.at(-1).email === 'staffA@ejemplo.test', r);
r = await adm('adminA', { action: 'resetPassword', userId: 'staffB' }); check('no se restablece la contraseña de usuarios de otra tienda (404)', r.s === 404, r);
r = await adm('adminA', { action: 'userHistory', userId: staffAid }); check('historial de acciones sobre un usuario visible', r.s === 200 && r.b.enabled && r.b.entries.length >= 2, r);
r = await adm('adminA', { action: 'userHistory', userId: 'staffB' }); check('historial de usuarios de otra tienda -> 404', r.s === 404, r);
r = await adm('adminA', { action: 'listAudit' }); check('auditoría global solo para alcance global -> 403', r.s === 403, r);
r = await adm('sup', { action: 'listAudit' }); check('superadmin consulta la auditoría global', r.s === 200 && r.b.entries.length > 5, r);
check('la auditoría guarda el rol real del actor', store.audit.some((a) => a.actorRole === 'superadmin') && store.audit.some((a) => a.actorRole === 'admin'));

// =============================================================== 3) TIENDAS
r = await adm('sup', { action: 'listStores' }); check('superadmin lista todas las tiendas', r.s === 200 && r.b.stores.length === 5, r);
r = await adm('adminA', { action: 'listStores' }); check('admin A solo ve su tienda', r.b.stores.length === 1 && r.b.stores[0].id === 'sA', r);
r = await adm('sup', { action: 'saveStore', store: { name: 'Sucursal C', address: 'Calle 1', phone: '5512345678', openHours: '09:00-22:00', deliveryFee: 15 } });
const cId = r.b.store && r.b.store.id;
check('superadmin crea una tienda', r.s === 200 && r.b.store.name === 'Sucursal C' && r.b.store.active === true, r);
r = await adm('adminA', { action: 'saveStore', store: { name: 'Tienda Pirata' } }); check('admin de tienda NO crea tiendas -> 403', r.s === 403, r);
r = await adm('adminA', { action: 'saveStore', storeId: 'sB', store: { name: 'Robada' } }); check('admin A NO edita la tienda B -> 403', r.s === 403 && r.b.code === 'store_forbidden', r);
r = await adm('adminA', { action: 'saveStore', storeId: 'sA', store: { active: false } }); check('admin A NO se desactiva su tienda -> 403', r.s === 403, r);
r = await adm('adminA', { action: 'saveStore', storeId: 'sA', store: { openHours: '00:00-00:00', prepMinutes: 20 } }); check('admin A edita horarios y preparación de su tienda', r.s === 200 && r.b.store.openHours === '00:00-00:00' && r.b.store.prepMinutes === 20, r);
r = await adm('adminA', { action: 'saveStore', storeId: 'sA', store: { openHours: 'abierto siempre' } }); check('horario inválido -> 422', r.s === 422, r);
r = await adm('adminA', { action: 'saveStore', storeId: 'sA', store: { imageUrl: 'http://x/y.png' } }); check('imagen no https -> 422', r.s === 422, r);
r = await adm('sup', { action: 'setStoreActive', storeId: cId, active: false }); check('superadmin desactiva una tienda', r.s === 200 && r.b.store.active === false, r);
r = await adm('adminA', { action: 'setStoreActive', storeId: 'sA', active: false }); check('setStoreActive solo superadmin -> 403', r.s === 403, r);
r = await adm('sup', { action: 'setStoreActive', storeId: cId, active: true });

// =============================================================== 4) PEDIDOS E INVENTARIO POR TIENDA
r = await createOrder(mk('cust1', { action: 'listStores' })); check('cliente lista solo tiendas activas con su estado de apertura', r.s === 200 && r.b.stores.some((s) => s.id === 'sA') && !r.b.stores.some((s) => s.id === 'sOff') && r.b.stores.every((s) => typeof s.open === 'boolean'), r);
check('la lista pública no expone configuración interna', r.b.stores.every((s) => !('coupons' in s) && !('deliveryFee' in s) && !('latitude' in s)), r.b.stores[0]);
r = await order('cust1', 'sA', [{ menuId: 'pA', quantity: 2 }]); const oA = store.orders.find((o) => o.$id === r.b.orderId);
check('pedido en tienda A: guarda storeId y descuenta SOLO stock de A (5-2=3)', r.s === 200 && oA.storeId === 'sA' && store.menu.find((m) => m.$id === 'pA').stock === 3 && store.menu.find((m) => m.$id === 'pB').stock === 5, [r, oA]);
check('tarifa de envío de la tienda A (12) y no la global', oA.deliveryFee === 12, oA.deliveryFee);
r = await order('cust1', 'sB', [{ menuId: 'pB', quantity: 1 }], { address: { ...addr, latitude: 19.43, longitude: -99.13 } }); const oB = store.orders.find((o) => o.$id === r.b.orderId);
check('pedido en tienda B: tarifa de B (30), stock propio', r.s === 200 && oB.storeId === 'sB' && oB.deliveryFee === 30 && store.menu.find((m) => m.$id === 'pB').stock === 4, [r, oB]);
r = await order('cust1', 'sA', [{ menuId: 'pB', quantity: 1 }]); check('producto de otra tienda en el pedido -> 422 y no toca el stock de B', r.s === 422 && r.b.code === 'product_other_store' && store.menu.find((m) => m.$id === 'pB').stock === 4, r);
r = await order('cust1', 'noExiste', [{ menuId: 'pA', quantity: 1 }]); check('tienda inexistente -> 422', r.s === 422 && r.b.code === 'store_not_found', r);
r = await order('cust1', 'sOff', [{ menuId: 'pA', quantity: 1 }]); check('tienda inactiva no recibe pedidos -> 409', r.s === 409 && r.b.code === 'store_inactive', r);
r = await order('cust1', 'sShut', [{ menuId: 'pShut', quantity: 1 }]); check('tienda con cierre manual -> 409 restaurant_closed (V14 por tienda)', r.s === 409 && r.b.code === 'restaurant_closed', r);
r = await order('cust1', 'sA', [{ menuId: 'pA', quantity: 1 }], { address: { ...addr, latitude: 21.0, longitude: -99.2 } }); check('radio de entrega por tienda: dirección fuera de cobertura -> 422', r.s === 422, r);
r = await order('cust1', 'sA', [{ menuId: 'pA', quantity: 1 }], { couponCode: 'AAA10' }); check('cupón de la tienda A aplica (10%)', r.s === 200 && store.orders.find((o) => o.$id === r.b.orderId).couponCode === 'AAA10', r);
r = await order('cust1', 'sB', [{ menuId: 'pB', quantity: 1 }], { couponCode: 'AAA10' }); check('el cupón de A NO vale en la tienda B -> 422', r.s === 422 && r.b.code === 'coupon_invalid', r);
r = await order('cust1', undefined, [{ menuId: 'pL', quantity: 1 }]); const oL = store.orders.find((o) => o.$id === r.b.orderId);
check('V14 compatible: sin storeId usa la tienda por omisión y su catálogo antiguo', r.s === 200 && oL.storeId === 'main', r);
r = await order('cust1', 'sA', [{ menuId: 'pA', quantity: 99 }]); check('stock insuficiente por tienda -> 409/422 y sin pedido', r.s !== 200, r);
r = await createOrder(mk('cust1', { action: 'quote', storeId: 'sB', address: addr, items: [{ menuId: 'pB', quantity: 1 }] })); check('cotización con la tarifa de la tienda elegida', r.s === 200 && r.b.deliveryFee === 30, r);

// aislamiento de pedidos / pagos / reportes
r = await adm('adminA', { action: 'listPayments', paymentMethod: 'cash_on_delivery' }); check('admin A: pagos solo de su tienda', r.s === 200 && r.b.payments.length > 0 && r.b.payments.every((p) => store.orders.find((o) => o.$id === p.orderId).storeId === 'sA'), r.b.payments.map((p) => p.orderId));
r = await adm('adminA', { action: 'report' }); check('admin A: reporte solo cuenta pedidos de su tienda', r.s === 200 && r.b.report.byStatus.pending === store.orders.filter((o) => o.storeId === 'sA').length, [r.b.report.byStatus, store.orders.filter((o) => o.storeId === 'sA').length]);
r = await adm('sup', { action: 'report' }); check('superadmin: reporte global', r.b.report.byStatus.pending === store.orders.length, [r.b.report.byStatus, store.orders.length]);
r = await adm('sup', { action: 'report', storeId: 'sB' }); check('superadmin filtra el reporte por tienda', r.b.report.byStatus.pending === 1, r.b.report.byStatus);
r = await adm('adminA', { action: 'dashboard', storeId: 'sB' }); const drvA = Object.keys(store.labels).filter((id) => store.labels[id].includes('driver') && store.labels[id].includes('stsA')).length;
check('admin A no puede pedir el dashboard de B con storeId (se ignora; solo repartidores de A)', r.s === 200 && r.b.driversSummary.total === drvA && drvA > 0, [r.b.driversSummary, drvA]);
r = await ops(mk('staffA', { action: 'listOrders' })); check('personal A: solo pedidos de su tienda', r.s === 200 && r.b.orders.length > 0 && r.b.orders.every((o) => store.orders.find((x) => x.$id === o.id)?.storeId === 'sA'), r.b.orders.map((o) => o.id));
r = await ops(mk('staffB', { orderId: oA.$id, status: 'confirmed' })); check('personal B NO modifica pedidos de A -> 404', r.s === 404 && oA.status === 'pending', r);
r = await ops(mk('staffA', { orderId: oA.$id, status: 'confirmed' })); check('personal A sí confirma pedidos de su tienda', r.s === 200 && oA.status === 'confirmed', r);
r = await ops(mk('legacyStaff', { orderId: oA.$id, status: 'preparing' })); check('personal V14 sin etiqueta de tienda = tienda "main": NO toca pedidos de A -> 404', r.s === 404, r);
r = await ops(mk('legacyStaff', { orderId: oL.$id, status: 'confirmed' })); check('personal V14 sin etiqueta sí opera pedidos de "main" (compatibilidad)', r.s === 200 && oL.status === 'confirmed', r);
r = await ops(mk('cust2', { orderId: oA.$id, status: 'cancelled' })); check('otro cliente no toca pedidos ajenos -> 404', r.s === 404, r);
r = await ops(mk('adminA', { action: 'refundOrder', orderId: oB.$id, reason: 'prueba' })); check('admin A no reembolsa pedidos de B -> 404', r.s === 404, r);
r = await ops(mk('staffB', { action: 'orderHistory', orderId: oA.$id })); check('personal B no ve el historial de pedidos de A -> 404', r.s === 404, r);

// repartidores por tienda
r = await ops(mk('staffA', { action: 'listDrivers' })); check('personal A ve solo repartidores de su tienda', r.s === 200 && r.b.drivers.length > 0 && r.b.drivers.every((d) => labelsOf(d.id).includes('stsA')), r.b.drivers.map((d) => d.id));
r = await ops(mk('staffA', { action: 'assignDriver', orderId: oA.$id, driverUserId: 'drvB' })); check('no se asigna un repartidor de otra tienda -> 422', r.s === 422 && r.b.code === 'driver_other_store', r);
r = await ops(mk('staffA', { action: 'assignDriver', orderId: oB.$id, driverUserId: 'drvA' })); check('personal A no asigna pedidos de B -> 404', r.s === 404, r);
store.status.drvA = false;
r = await ops(mk('staffA', { action: 'assignDriver', orderId: oA.$id, driverUserId: 'drvA' })); check('no se asigna a un repartidor desactivado -> 422', r.s === 422, r);
store.status.drvA = true;
r = await ops(mk('staffA', { action: 'assignDriver', orderId: oA.$id, driverUserId: 'drvA' })); check('asignación correcta dentro de la tienda', r.s === 200 && oA.driverUserId === 'drvA', r);
r = await ops(mk('drvB', { action: 'claimOrder', orderId: oA.$id })); check('repartidor de B no reclama pedidos de A -> 404', r.s === 404, r);
oB.status = 'ready';
r = await ops(mk('drvA', { action: 'availableOrders' })); check('repartidor A no ve pedidos disponibles de B', r.s === 200 && !r.b.orders.some((o) => o.id === oB.$id), r.b.orders.map((o) => o.id));
r = await ops(mk('drvB', { action: 'availableOrders' })); check('repartidor B sí ve el pedido disponible de su tienda', r.s === 200 && r.b.orders.some((o) => o.id === oB.$id), r.b.orders.map((o) => o.id));
r = await ops(mk('drvA', { action: 'claimOrder', orderId: oB.$id })); check('repartidor A no reclama pedidos de B -> 404', r.s === 404, r);
r = await ops(mk('drvB', { action: 'claimOrder', orderId: oB.$id })); check('repartidor B reclama el pedido de su tienda', r.s === 200 && oB.driverUserId === 'drvB', r);
r = await ops(mk('legacyDrv', { action: 'claimOrder', orderId: oA.$id })); check('repartidor V14 sin etiqueta no toma pedidos de otra tienda -> 404', r.s === 404, r);
r = await ops(mk('drvB', { orderId: oA.$id, status: 'picked_up' })); check('repartidor no modifica pedidos que no son suyos', r.s === 403 || r.s === 404, r);
r = await ops(mk('staffA', { action: 'driverHistory', driverUserId: 'drvB' })); check('historial de repartidor de otra tienda no muestra pedidos ajenos', r.s === 200 && r.b.orders.length === 0, r);

// inventario por tienda
r = await adm('adminA', { action: 'listProducts' }); check('admin A lista solo productos de su tienda', r.s === 200 && r.b.products.length > 0 && r.b.products.every((p) => p.storeId === 'sA'), r.b.products.map((p) => p.id));
r = await adm('sup', { action: 'listProducts', storeId: 'sB' }); check('superadmin filtra productos por tienda', r.b.products.every((p) => p.storeId === 'sB') && r.b.products.length === 1, r.b.products);
r = await adm('adminA', { action: 'adjustStock', productId: 'pB', delta: 10, reason: 'robo' }); check('admin A NO ajusta stock de productos de B -> 404', r.s === 404 && store.menu.find((m) => m.$id === 'pB').stock === 4, r);
r = await adm('adminA', { action: 'adjustStock', productId: 'pA', delta: 10, reason: 'entrada de proveedor' }); check('admin A ajusta stock de su producto con motivo y usuario responsable', r.s === 200 && store.menu.find((m) => m.$id === 'pA').stock === 12 && store.moves.at(-1).actorId === 'adminA' && store.moves.at(-1).reason === 'entrada de proveedor' && store.moves.at(-1).storeId === 'sA', store.moves.at(-1));
r = await adm('adminA', { action: 'adjustStock', productId: 'pA', delta: -500, reason: 'merma' }); check('no se permite stock negativo -> 422', r.s === 422 && store.menu.find((m) => m.$id === 'pA').stock === 12, r);
r = await adm('adminA', { action: 'stockMovements' }); check('movimientos de inventario: solo de productos de su tienda', r.s === 200 && r.b.movements.length > 0 && r.b.movements.every((m) => ['pA'].includes(m.menuId)), r.b.movements.map((m) => m.menuId));
r = await adm('adminA', { action: 'saveProduct', product: { name: 'Nuevo A', price: 15, stock: 7 } }); const newA = store.menu.find((m) => m.$id === r.b.product?.id);
check('producto nuevo creado por admin A queda en la tienda A', r.s === 200 && newA.storeId === 'sA', r);
r = await adm('adminA', { action: 'saveProduct', productId: 'pB', product: { price: 1 } }); check('admin A NO edita precios de la tienda B -> 404', r.s === 404 && store.menu.find((m) => m.$id === 'pB').price === 20, r);
r = await adm('adminA', { action: 'saveProduct', productId: 'pA', storeId: 'sB', product: { price: 11 } }); check('editar un producto no cambia su tienda (storeId ignorado)', r.s === 200 && store.menu.find((m) => m.$id === 'pA').storeId === 'sA', r);
r = await adm('adminA', { action: 'saveProduct', storeId: 'sB', product: { name: 'En B', price: 9 } }); const inA = store.menu.find((m) => m.$id === r.b.product?.id);
check('admin A no crea productos en B enviando storeId: queda en A', r.s === 200 && inA.storeId === 'sA', r);
r = await adm('sup', { action: 'saveProduct', storeId: 'sB', product: { name: 'Super en B', price: 9 } }); check('superadmin crea productos en la tienda que elige', r.s === 200 && store.menu.find((m) => m.$id === r.b.product.id).storeId === 'sB', r);
r = await adm('adminA', { action: 'reconcileInventory' }); check('conciliar inventario global -> 403 para admin de tienda', r.s === 403, r);

// =============================================================== V16: categorías por tienda
store.cats.push({ $id: 'catCommon', name: 'Común heredada' });
r = await adm('adminA', { action: 'saveCategory', category: { name: 'Hamburguesas A' } }); const catA = store.cats.find((c) => c.$id === r.b.category?.id);
check('V16: admin A crea una categoría y queda en SU tienda', r.s === 200 && catA.storeId === 'sA', r);
r = await adm('adminB', { action: 'saveCategory', storeId: 'sA', category: { name: 'Intento B en A' } }); const catB = store.cats.find((c) => c.$id === r.b.category?.id);
check('V16: admin B no crea categorías en A enviando storeId (queda en B)', r.s === 200 && catB.storeId === 'sB', r);
r = await adm('adminA', { action: 'listCategories' }); const idsA = (r.b.categories || []).map((c) => c.id);
check('V16: admin A ve su categoría y las comunes, NO las de B', idsA.includes(catA.$id) && idsA.includes('catCommon') && !idsA.includes(catB.$id), idsA);
r = await adm('adminB', { action: 'saveCategory', categoryId: catA.$id, category: { name: 'Robada' } }); check('V16: admin B no edita categorías de A -> 404', r.s === 404 && catA.name === 'Hamburguesas A', r);
r = await adm('adminB', { action: 'setCategoryActive', categoryId: catA.$id, active: false }); check('V16: admin B no desactiva categorías de A -> 404', r.s === 404 && catA.active !== false, r);
r = await adm('adminB', { action: 'deleteCategory', categoryId: catA.$id }); check('V16: admin B no borra categorías de A -> 404', r.s === 404 && store.cats.some((c) => c.$id === catA.$id), r);
r = await adm('adminA', { action: 'saveCategory', categoryId: 'catCommon', category: { name: 'Editada' } }); check('V16: una categoría común solo la edita el alcance global -> 403', r.s === 403, r);
r = await adm('staffA', { action: 'saveCategory', category: { name: 'Staff no' } }); check('V16: el personal (no admin) no crea categorías -> 403', r.s === 403, r);
r = await adm('sup', { action: 'saveCategory', category: { name: 'Común nueva' } }); const catC = store.cats.find((c) => c.$id === r.b.category?.id);
check('V16: superadmin sin storeId crea una categoría común', r.s === 200 && !catC.storeId, r);
r = await adm('sup', { action: 'saveCategory', storeId: 'sB', category: { name: 'Super en B' } }); const catSB = store.cats.find((c) => c.$id === r.b.category?.id);
check('V16: superadmin crea categoría en la tienda que elige', r.s === 200 && catSB.storeId === 'sB', r);
r = await adm('sup', { action: 'saveCategory', storeId: 'sOff', category: { name: 'En inactiva' } }); check('V16: no se crean categorías en tiendas inactivas -> 422', r.s === 422 && r.b.code === 'store_inactive', r);
r = await adm('sup', { action: 'listCategories', storeId: 'sB' }); const idsSB = (r.b.categories || []).map((c) => c.id);
check('V16: superadmin filtra por tienda B (sus categorías + comunes, no las de A)', idsSB.includes(catB.$id) && idsSB.includes(catSB.$id) && !idsSB.includes(catA.$id), idsSB);
r = await adm('sup', { action: 'listCategories' }); check('V16: superadmin sin filtro ve todas', ['catCommon', catA.$id, catB.$id, catSB.$id].every((i) => (r.b.categories || []).some((c) => c.id === i)), r.b);
r = await adm('adminA', { action: 'saveProduct', product: { name: 'Prod cat B', price: 5, categories: catB.$id } }); check('V16: un producto de A no usa una categoría de B -> 422', r.s === 422 && r.b.code === 'category_other_store', r);
r = await adm('adminA', { action: 'saveProduct', product: { name: 'Prod cat A', price: 5, categories: catA.$id } }); check('V16: un producto de A usa categoría de A', r.s === 200, r);
r = await adm('adminA', { action: 'saveProduct', product: { name: 'Prod cat común', price: 5, categories: 'catCommon' } }); check('V16: un producto usa una categoría común', r.s === 200, r);
r = await adm('adminA', { action: 'deleteCategory', categoryId: catA.$id }); check('V16: no se borra categoría con productos -> 409', r.s === 409, r);
r = await adm('adminB', { action: 'deleteCategory', categoryId: catB.$id }); check('V16: admin B borra su categoría vacía', r.s === 200 && !store.cats.some((c) => c.$id === catB.$id), r);

// V14 sobre multitienda: cancelacion del cliente, calificacion
r = await ops(mk('cust1', { orderId: oA.$id, status: 'cancelled' }));
check('V14: el cliente cancela su pedido confirmado y se devuelve el stock a SU tienda', r.s === 200 && oA.status === 'cancelled' && store.menu.find((m) => m.$id === 'pA').stock === 14 && store.menu.find((m) => m.$id === 'pB').stock === 4, [r, store.menu.find((m) => m.$id === 'pA').stock]);
oB.status = 'delivered';
r = await ops(mk('cust1', { action: 'rateOrder', orderId: oB.$id, rating: 5, driverRating: 4 })); check('V14: calificación de pedido entregado en tienda B', r.s === 200 && oB.rating === 5, r);
r = await adm('adminB', { action: 'dashboard' }); check('V14: dashboard de B incluye sus calificaciones; el de A no las ve', r.s === 200 && r.b.dashboard.ratings.count === 1, r.b.dashboard.ratings);
r = await adm('adminA', { action: 'dashboard' }); check('V14: dashboard de A no incluye calificaciones de B', r.s === 200 && (!r.b.dashboard.ratings || r.b.dashboard.ratings.count === 0), r.b.dashboard.ratings);

// ---- Plan gratuito: el paquete generado (2 funciones) enruta las acciones nuevas igual que las funciones sueltas.
const two = (await import('./plan-gratuito/update-order-status/src/main.js')).default;
const twoCreate = (await import('./plan-gratuito/create-order/src/main.js')).default;
r = await two(mk('sup', { action: 'createUser', user: { name: 'Via Bundle', email: 'bundle@ejemplo.com', role: 'driver', storeId: 'sB' } })); check('plan gratuito: createUser pasa por update-order-status (admin.js)', r.s === 200 && r.b.user.role === 'driver', r);
r = await two(mk('adminA', { action: 'listUsers' })); check('plan gratuito: listUsers respeta el aislamiento por tienda', r.s === 200 && r.b.users.every((u) => u.storeId === 'sA'), r);
r = await twoCreate(mk('cust1', { action: 'listStores' })); check('plan gratuito: listStores (cliente) en create-order', r.s === 200 && r.b.enabled === true && r.b.stores.length >= 3, r);
r = await two(mk('staffA', { action: 'listOrders' })); check('plan gratuito: listOrders (estado) respeta la tienda', r.s === 200 && r.b.orders.every((o) => store.orders.find((x) => x.$id === o.id)?.storeId === 'sA'), r);

console.log(`\nV15: ${ok} ok, ${bad} fallas`); process.exit(bad ? 1 : 0);
