import { store } from 'node-appwrite';
for (const [k, v] of Object.entries({ DATABASE_ID: 'db', ORDERS_TABLE_ID: 'orders', ORDER_ITEMS_TABLE_ID: 'items', MENU_TABLE_ID: 'menu', CUSTOMIZATIONS_TABLE_ID: 'cust', MENU_CUSTOMIZATIONS_TABLE_ID: 'rel' })) process.env[k] = v;
const createOrder = (await import('./create-order/src/main.js')).default;
const updStatus = (await import('./update-order-status/src/main.js')).default;
const mk = (user, body) => ({ req: { headers: user ? { 'x-appwrite-user-id': user, 'x-appwrite-key': 'k' } : {}, bodyJson: body }, res: { json: (b, s = 200) => ({ s, b }) }, log(){}, error(){} });
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FALLA'), name, cond ? '' : JSON.stringify(extra)); };

store.menu.push({ $id: 'm1', name: 'Burger', price: 10 }, { $id: 'm2', name: 'Pizza', price: 12 });
store.cust.push({ $id: 'c1', name: 'Queso', price: 1.5, type: 't' }, { $id: 'c2', name: 'Tocino', price: 2, type: 't' });
store.rel.push({ $id: 'r1', menu: 'm1', customizations: 'c1' }, { $id: 'r2', menu: { $id: 'm2' }, customizations: { $id: 'c2' } });
store.labels = { u1: [], u2: [], staff1: ['staff'], drv1: ['driver'], drv2: ['driver'] };
store.names = { u1: 'Bryan', drv1: 'Luis', drv2: 'Ana', staff1: 'Admin' };

const body = (o = {}) => ({ clientRequestId: 'chk_12345678', address: { line: 'Av. Reforma 123, Centro', label: 'home', latitude: 19.5, longitude: -99.2 }, contact: { name: 'FALSO', phone: '55 1234 5678' },
  items: [{ menuId: 'm1', quantity: 2, customizationIds: ['c1'], price: 0.01 }], total: 0.01, ...o });

// ---------- create-order
let r = await createOrder(mk(null, body())); check('sin sesión -> 401', r.s === 401, r);
r = await createOrder(mk('u1', body())); check('crea pedido con total del servidor (23+5-0.5)', r.s === 200 && store.orders[0].total === 27.5 && store.orders[0].status === 'pending', r);
check('nombre tomado de la cuenta, no del cliente', store.orders[0].customerName === 'Bryan');
check('permiso de lectura solo del dueño', JSON.stringify(store.orders[0].permissions) === '["read(user:u1)"]');
r = await createOrder(mk('u1', body())); check('reintento -> mismo pedido, sin duplicar', r.b.duplicate === true && store.orders.length === 1, r);
r = await createOrder(mk('u2', body())); check('mismo requestId de otro usuario -> 409', r.s === 409, r);
const other = (o) => body({ clientRequestId: 'chk_' + Math.random().toString(36).slice(2, 12), ...o });
r = await createOrder(mk('u1', other({ items: [{ menuId: 'zzz', quantity: 1 }] }))); check('producto inexistente -> 422', r.s === 422, r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1, customizationIds: ['c2'] }] }))); check('extra de otro producto -> 422 extra_not_allowed', r.s === 422 && r.b.code === 'extra_not_allowed', r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm2', quantity: 1, customizationIds: ['c2'] }] }))); check('extra válido con relación como objeto -> 200', r.s === 200, r);
r = await createOrder(mk('u1', other({ contact: { phone: '123' } }))); check('teléfono inválido -> 400', r.s === 400 && r.b.code === 'bad_phone', r);
r = await createOrder(mk('u1', other({ address: { line: 'Calle 12345, Col. Centro', latitude: 95, longitude: 10 } }))); check('latitud fuera de rango -> 400', r.s === 400, r);
r = await createOrder(mk('u1', other({ address: { line: 'Calle 12345, Col. Centro', latitude: 19.5 } }))); check('coordenadas incompletas -> 400', r.s === 400, r);
r = await createOrder(mk('u1', other({ address: { line: 'corta' } }))); check('dirección corta -> 400', r.s === 400, r);
r = await createOrder(mk('u1', other({ clientRequestId: 'x' }))); check('requestId inválido -> 400', r.s === 400, r);
const before = store.orders.length; store.failItemAt = store.items.length + 1;
r = await createOrder(mk('u1', other())); check('falla de artículo -> 500 y se deshace', r.s === 500 && store.orders.length === before, r);
store.failItemAt = 0;

// ---------- update-order-status
const oid = store.orders[0].$id;
r = await updStatus(mk('u2', { orderId: oid, status: 'cancelled' })); check('otro cliente -> 404', r.s === 404, r);
r = await updStatus(mk('u1', { orderId: oid, status: 'delivered' })); check('cliente no puede marcar entregado', r.s >= 400 && store.orders[0].status === 'pending', r);
r = await updStatus(mk('staff1', { orderId: oid, status: 'confirmed' })); check('staff confirma', r.s === 200, r);
r = await updStatus(mk('u1', { orderId: oid, status: 'cancelled' })); check('cliente ya no cancela tras confirmar', r.s === 403 && store.orders[0].status === 'confirmed', r);
r = await updStatus(mk('staff1', { orderId: oid, status: 'preparing' })); check('staff -> preparing', r.s === 200);
r = await updStatus(mk('staff1', { orderId: oid, status: 'on_the_way' })); check('sin repartidor no sale a reparto -> driver_required', r.s === 409 && r.b.code === 'driver_required', r);

// ---------- staff-api
r = await updStatus(mk('u1', { action: 'listOrders' })); check('cliente no lista pedidos de todos -> 403', r.s === 403, r);
r = await updStatus(mk('staff1', { action: 'listOrders', status: 'preparing' })); check('staff lista pedidos filtrados y con artículos', r.s === 200 && r.b.orders.length === 1 && r.b.orders[0].items[0].name === 'Burger', r);
check('la vista de staff no expone userId', !('userId' in r.b.orders[0]));
r = await updStatus(mk('staff1', { action: 'listOrders', status: 'raro' })); check('estado inválido -> 400', r.s === 400, r);
r = await updStatus(mk('staff1', { action: 'listDrivers' })); check('lista solo repartidores', r.s === 200 && r.b.drivers.map((d) => d.id).sort().join() === 'drv1,drv2', r);
r = await updStatus(mk('u1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1' })); check('cliente no asigna repartidor -> 403', r.s === 403, r);
r = await updStatus(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'u2' })); check('no se asigna a quien no es repartidor -> 422', r.s === 422, r);
r = await updStatus(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1' })); check('staff asigna repartidor', r.s === 200 && store.orders[0].driverName === 'Luis', r);
r = await updStatus(mk('drv1', { action: 'listOrders' })); check('repartidor no lista todos los pedidos -> 403', r.s === 403, r);
r = await updStatus(mk('drv1', { action: 'myDeliveries' })); check('repartidor ve sus entregas activas', r.s === 200 && r.b.orders.length === 1, r);
r = await updStatus(mk('drv2', { action: 'myDeliveries' })); check('otro repartidor no ve pedidos ajenos', r.s === 200 && r.b.orders.length === 0, r);
r = await updStatus(mk('u1', { action: 'myDeliveries' })); check('cliente no usa myDeliveries -> 403', r.s === 403, r);
r = await updStatus(mk('staff1', { action: 'borrarTodo' })); check('acción desconocida -> 400', r.s === 400, r);

// ---------- continúa el flujo con repartidor
r = await updStatus(mk('drv2', { orderId: oid, status: 'on_the_way' })); check('repartidor no asignado -> 403', r.s === 403, r);
r = await updStatus(mk('drv1', { orderId: oid, status: 'on_the_way' })); check('repartidor asignado sale a reparto', r.s === 200, r);
r = await updStatus(mk('u1', { action: 'updateDriverLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('cliente no mueve al repartidor -> 403', r.s === 403 && !store.orders[0].driverLatitude, r);
r = await updStatus(mk('drv2', { action: 'updateDriverLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('repartidor ajeno no actualiza ubicación -> 403', r.s === 403, r);
r = await updStatus(mk('drv1', { action: 'updateDriverLocation', orderId: oid, latitude: 0, longitude: 0 })); check('0,0 rechazado', r.s === 400, r);
r = await updStatus(mk('drv1', { action: 'updateDriverLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('repartidor asignado actualiza ubicación', r.s === 200 && store.orders[0].driverLatitude === 19.5, r);
r = await updStatus(mk('drv1', { action: 'updateDriverLocation', orderId: oid, latitude: 19.51, longitude: -99.2 })); check('actualización inmediata -> 429', r.s === 429, r);
r = await updStatus(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv2' })); check('reasignar descarta ubicación anterior', r.s === 200 && store.orders[0].driverLatitude === null, r);
r = await updStatus(mk('drv2', { orderId: oid, status: 'delivered' })); check('entregado por el nuevo repartidor', r.s === 200 && store.orders[0].status === 'delivered', r);
check('al terminar no se conserva ubicación', store.orders[0].driverLatitude === null);
r = await updStatus(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1' })); check('pedido terminado no se reasigna -> 409', r.s === 409, r);
r = await updStatus(mk('staff1', { orderId: oid, status: 'cancelled' })); check('entregado no se cancela', r.s === 409, r);

console.log(`\n${ok} ok, ${bad} fallas`); process.exit(bad ? 1 : 0);
