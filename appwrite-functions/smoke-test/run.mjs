import { store } from 'node-appwrite';
for (const [k, v] of Object.entries({ DATABASE_ID: 'db', ORDERS_TABLE_ID: 'orders', ORDER_ITEMS_TABLE_ID: 'items', MENU_TABLE_ID: 'menu', CUSTOMIZATIONS_TABLE_ID: 'cust', MENU_CUSTOMIZATIONS_TABLE_ID: 'rel', ORDER_EVENTS_TABLE_ID: 'events', USERS_TABLE_ID: 'users', MP_ACCESS_TOKEN: 'TEST-token-no-real', PAYMENT_RETURN_URL: 'https://equipo.github.io/delivery/pago.html' })) process.env[k] = v;

// ---- doble de fetch: Mercado Pago y Expo Push (no hay red real)
const net = { calls: [], mp: { prefOk: true, payments: [] }, expo: { response: { data: [{ status: 'ok', id: 't1' }] }, fail: false } };
globalThis.fetch = async (url, opts = {}) => {
  net.calls.push({ url: String(url), opts });
  const json = (b, ok = true) => ({ ok, json: async () => b });
  if (String(url).includes('api.mercadopago.com/checkout/preferences')) return net.mp.prefOk ? json({ id: 'pref1', init_point: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref1' }) : json({}, false);
  if (String(url).includes('api.mercadopago.com/v1/payments/search')) return json({ results: net.mp.payments });
  if (String(url).includes('exp.host/--/api/v2/push/send')) { if (net.expo.fail) throw new Error('expo caido'); return json(net.expo.response); }
  throw new Error('URL inesperada ' + url);
};
const createOrder = (await import('./create-order/src/main.js')).default;
const ops = (await import('./update-order-status/src/main.js')).default;
const pushCalls = () => net.calls.filter((c) => c.url.includes('exp.host'));
const mk = (user, body) => ({ req: { headers: user ? { 'x-appwrite-user-id': user, 'x-appwrite-key': 'k' } : {}, bodyJson: body }, res: { json: (b, s = 200) => ({ s, b }) }, log(){}, error(){} });
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FALLA'), name, cond ? '' : JSON.stringify(extra)); };

store.menu.push({ $id: 'm1', name: 'Burger', price: 10 }, { $id: 'm2', name: 'Pizza', price: 12 }, { $id: 'm3', name: 'Agotado', price: 5, available: false });
store.cust.push({ $id: 'c1', name: 'Queso', price: 1.5, type: 't' }, { $id: 'c2', name: 'Tocino', price: 2, type: 't' });
store.rel.push({ $id: 'r1', menu: 'm1', customizations: 'c1' }, { $id: 'r2', menu: { $id: 'm2' }, customizations: { $id: 'c2' } });
store.labels = { u1: [], u2: [], staff1: ['staff'], staff2: ['staff'], drv1: ['driver'], drv2: ['driver'] };
store.names = { u1: 'Bryan', drv1: 'Luis', drv2: 'Ana', staff1: 'Admin' };

const body = (o = {}) => ({ clientRequestId: 'chk_12345678', address: { line: 'Av. Reforma 123, Centro', label: 'home', latitude: 19.5, longitude: -99.2 }, contact: { name: 'FALSO', phone: '55 1234 5678' },
  items: [{ menuId: 'm1', quantity: 2, customizationIds: ['c1'], price: 0.01 }], total: 0.01, ...o });
const other = (o) => body({ clientRequestId: 'chk_' + Math.random().toString(36).slice(2, 12), ...o });

// ---------- create-order
let r = await createOrder(mk(null, body())); check('sin sesión -> 401', r.s === 401, r);
r = await createOrder(mk('u1', body())); check('crea pedido con total del servidor (23+5-0.5)', r.s === 200 && store.orders[0].total === 27.5 && store.orders[0].status === 'pending', r);
check('nombre tomado de la cuenta, no del cliente', store.orders[0].customerName === 'Bryan');
check('permiso de lectura solo del dueño', JSON.stringify(store.orders[0].permissions) === '["read(user:u1)"]');
check('registra evento "created"', store.events.length === 1 && store.events[0].type === 'created');
r = await createOrder(mk('u1', body())); check('reintento -> mismo pedido, sin duplicar', r.b.duplicate === true && store.orders.length === 1 && store.events.length === 1, r);
r = await createOrder(mk('u2', body())); check('mismo requestId de otro usuario -> 409', r.s === 409, r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'zzz', quantity: 1 }] }))); check('producto inexistente -> 422', r.s === 422, r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm3', quantity: 1 }] }))); check('producto no disponible -> 422 unavailable', r.s === 422 && r.b.code === 'unavailable', r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1, customizationIds: ['c2'] }] }))); check('extra de otro producto -> 422', r.s === 422 && r.b.code === 'extra_not_allowed', r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm2', quantity: 1, customizationIds: ['c2'] }] }))); check('extra válido con relación como objeto -> 200', r.s === 200, r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: -3 }] }))); check('cantidad negativa -> 422', r.s === 422, r);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 51 }] }))); check('cantidad excesiva -> 422', r.s === 422, r);
r = await createOrder(mk('u1', other({ contact: { phone: '123' } }))); check('teléfono inválido -> 400', r.s === 400 && r.b.code === 'bad_phone', r);
r = await createOrder(mk('u1', other({ address: { line: 'Calle 12345, Col. Centro', latitude: 95, longitude: 10 } }))); check('latitud fuera de rango -> 400', r.s === 400, r);
r = await createOrder(mk('u1', other({ address: { line: 'corta' } }))); check('dirección corta -> 400', r.s === 400, r);
r = await createOrder(mk('u1', other({ clientRequestId: 'x' }))); check('requestId inválido -> 400', r.s === 400, r);
store.failEvents = true;
r = await createOrder(mk('u1', other())); check('si el historial falla, el pedido igual se crea', r.s === 200, r);
store.failEvents = false;
const before = store.orders.length; store.failItemAt = store.items.length + 1;
r = await createOrder(mk('u1', other())); check('falla de artículo -> 500 y se deshace', r.s === 500 && store.orders.length === before, r);
store.failItemAt = 0;

// ---------- updateStatus
const o1 = store.orders[0]; const oid = o1.$id;
r = await ops(mk('u2', { orderId: oid, status: 'cancelled' })); check('otro cliente -> 404', r.s === 404, r);
r = await ops(mk('u1', { orderId: oid, status: 'delivered' })); check('cliente no puede marcar entregado', r.s >= 400 && o1.status === 'pending', r);
r = await ops(mk('staff1', { orderId: oid, status: 'confirmed', expectedStatus: 'pending', expectedUpdatedAt: o1.$updatedAt })); check('staff confirma con datos vigentes', r.s === 200 && o1.status === 'confirmed', r);
r = await ops(mk('staff2', { orderId: oid, status: 'cancelled', expectedStatus: 'pending' })); check('segundo empleado con datos viejos -> 409 stale_order', r.s === 409 && r.b.code === 'stale_order' && o1.status === 'confirmed', r);
r = await ops(mk('staff2', { orderId: oid, status: 'preparing', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })); check('fecha de actualización vieja -> 409', r.s === 409 && r.b.code === 'stale_order', r);
r = await ops(mk('u1', { orderId: oid, status: 'cancelled' })); check('cliente ya no cancela tras confirmar', r.s === 403 && o1.status === 'confirmed', r);
r = await ops(mk('staff1', { orderId: oid, status: 'preparing' })); check('staff -> preparing', r.s === 200);
r = await ops(mk('staff1', { orderId: oid, status: 'on_the_way' })); check('sin repartidor -> driver_required', r.s === 409 && r.b.code === 'driver_required', r);

// ---------- listOrders / filtros
r = await ops(mk('u1', { action: 'listOrders' })); check('cliente no lista pedidos de todos -> 403', r.s === 403, r);
r = await ops(mk('drv1', { action: 'listOrders' })); check('repartidor no lista todos -> 403', r.s === 403, r);
r = await ops(mk('staff1', { action: 'listOrders', status: 'preparing' })); check('filtra por estado e incluye artículos', r.s === 200 && r.b.orders.length === 1 && r.b.orders[0].items[0].name === 'Burger', r);
check('la vista de staff no expone userId', !('userId' in r.b.orders[0]) && typeof r.b.orders[0].updatedAt === 'string');
r = await ops(mk('staff1', { action: 'listOrders', status: 'raro' })); check('estado inválido -> 400', r.s === 400, r);
r = await ops(mk('staff1', { action: 'listOrders', from: 'no-es-fecha' })); check('fecha inválida -> 400', r.s === 400 && r.b.code === 'bad_date', r);
r = await ops(mk('staff1', { action: 'listOrders', from: '2026-01-02T00:00:00Z' })); check('filtro por fecha excluye pedidos anteriores', r.s === 200 && r.b.orders.length === 0, r);
r = await ops(mk('staff1', { action: 'listOrders', from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' })); check('rango de fechas incluye pedidos', r.s === 200 && r.b.orders.length >= 1, r);
r = await ops(mk('staff1', { action: 'listOrders', query: '#' + oid.slice(-6) })); check('búsqueda por últimos caracteres del id', r.s === 200 && r.b.orders.length === 1 && r.b.orders[0].id === oid, r);
r = await ops(mk('staff1', { action: 'listOrders', query: 'zz' })); check('búsqueda muy corta no devuelve todo', r.s === 200 && r.b.orders.length === 0, r);

// ---------- drivers / assign
r = await ops(mk('staff1', { action: 'listDrivers' })); check('lista solo repartidores', r.s === 200 && r.b.drivers.map((d) => d.id).sort().join() === 'drv1,drv2', r);
r = await ops(mk('u1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1' })); check('cliente no asigna repartidor -> 403', r.s === 403, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'u2' })); check('no se asigna a quien no es repartidor -> 422', r.s === 422, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })); check('asignar con datos viejos -> 409', r.s === 409 && !o1.driverUserId, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1', expectedUpdatedAt: o1.$updatedAt })); check('staff asigna repartidor', r.s === 200 && o1.driverName === 'Luis', r);
r = await ops(mk('drv1', { action: 'myDeliveries' })); check('repartidor ve sus entregas activas', r.s === 200 && r.b.orders.length === 1, r);
r = await ops(mk('drv2', { action: 'myDeliveries' })); check('otro repartidor no ve pedidos ajenos', r.s === 200 && r.b.orders.length === 0, r);
r = await ops(mk('u1', { action: 'myDeliveries' })); check('cliente no usa myDeliveries -> 403', r.s === 403, r);
r = await ops(mk('staff1', { action: 'borrarTodo' })); check('acción desconocida -> 400', r.s === 400, r);

// ---------- reparto y ubicación
r = await ops(mk('drv2', { orderId: oid, status: 'on_the_way' })); check('repartidor no asignado -> 403', r.s === 403, r);
r = await ops(mk('drv1', { orderId: oid, status: 'on_the_way' })); check('repartidor asignado sale a reparto', r.s === 200, r);
r = await ops(mk('u1', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('cliente no mueve al repartidor -> 403', r.s === 403 && !o1.driverLatitude, r);
r = await ops(mk('drv2', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('repartidor ajeno no actualiza ubicación -> 403', r.s === 403, r);
r = await ops(mk('drv1', { action: 'updateLocation', orderId: oid, latitude: 0, longitude: 0 })); check('0,0 rechazado', r.s === 400, r);
r = await ops(mk('drv1', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('repartidor asignado actualiza ubicación', r.s === 200 && o1.driverLatitude === 19.5, r);
r = await ops(mk('drv1', { action: 'updateLocation', orderId: oid, latitude: 19.51, longitude: -99.2 })); check('actualización inmediata -> 429', r.s === 429, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv2' })); check('reasignar descarta ubicación anterior', r.s === 200 && o1.driverLatitude === null, r);
r = await ops(mk('drv2', { orderId: oid, status: 'delivered' })); check('entregado por el nuevo repartidor', r.s === 200 && o1.status === 'delivered', r);
check('al terminar no se conserva ubicación', o1.driverLatitude === null);
r = await ops(mk('drv2', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('pedido entregado ya no acepta ubicación -> 409', r.s === 409, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1' })); check('pedido terminado no se reasigna -> 409', r.s === 409, r);
r = await ops(mk('staff1', { orderId: oid, status: 'cancelled' })); check('entregado no se cancela', r.s === 409, r);

// ---------- historial
r = await ops(mk('staff1', { action: 'orderHistory', orderId: oid })); const types = r.b.events?.map((e) => e.type + ':' + (e.to ?? ''));
check('historial: creación, estados y asignaciones en orden', r.s === 200 && r.b.enabled && types[0] === 'created:pending' && types.includes('status:confirmed') && types.filter((t) => t.startsWith('driver_assigned')).length === 2 && types.at(-1) === 'status:delivered', types);
r = await ops(mk('u1', { action: 'orderHistory', orderId: oid })); check('cliente no ve el historial -> 403', r.s === 403, r);
store.failEvents = true; const o2 = store.orders.find((o) => o.status === 'pending' && o.$id !== oid);
r = await ops(mk('staff1', { orderId: o2.$id, status: 'confirmed' })); check('si el historial falla, el cambio de estado igual se aplica', r.s === 200 && o2.status === 'confirmed', r);


// ---------- pago en línea (Mercado Pago)
const FIXEDTOK = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
store.users.push({ $id: 'p-u1', accountId: 'u1', pushToken: FIXEDTOK }, { $id: 'p-drv2', accountId: 'drv2', pushToken: 'ExponentPushToken[driver-token-0000001]' });
r = await createOrder(mk('u1', other({ paymentMethod: 'bitcoin' }))); check('método de pago desconocido -> 400', r.s === 400 && r.b.code === 'bad_payment_method', r);
r = await createOrder(mk('u1', other())); check('pedido en efectivo: paymentStatus not_required', r.s === 200 && store.orders.find((o) => o.$id === r.b.orderId).paymentStatus === 'not_required' && !r.b.checkoutUrl, r);
const cashId = r.b.orderId;
net.calls.length = 0;
const onlineBody = other({ paymentMethod: 'online', items: [{ menuId: 'm2', quantity: 2, price: 0.01 }], total: 0.01 });
r = await createOrder(mk('u1', onlineBody)); const op = store.orders.find((o) => o.$id === r.b.orderId);
check('pago en línea: crea pedido pending y devuelve enlace de pago', r.s === 200 && op.paymentMethod === 'online' && op.paymentStatus === 'pending' && r.b.checkoutUrl?.startsWith('https://'), r);
const prefCall = net.calls.find((c) => c.url.includes('checkout/preferences')); const prefBody = JSON.parse(prefCall.opts.body);
check('el importe de la preferencia lo calcula el servidor (24+5-0.5=28.5), no el cliente', prefBody.items[0].unit_price === 28.5 && prefBody.external_reference === op.$id && prefBody.items[0].currency_id === 'MXN', prefBody);
check('la preferencia se pide con el token del servidor', prefCall.opts.headers.Authorization === 'Bearer TEST-token-no-real');
r = await createOrder(mk('u1', onlineBody)); check('reintento devuelve el mismo enlace sin crear otro pedido', r.b.duplicate === true && r.b.checkoutUrl === op.paymentUrl, r);
const nBefore = store.orders.length; net.mp.prefOk = false;
r = await createOrder(mk('u1', other({ paymentMethod: 'online' }))); check('si Mercado Pago falla -> 502 y no queda pedido huérfano', r.s === 502 && r.b.code === 'payment_unavailable' && store.orders.length === nBefore, r);
net.mp.prefOk = true;
{ const saved = { t: process.env.MP_ACCESS_TOKEN };
  delete process.env.MP_ACCESS_TOKEN;
  const noPay = (await import('./create-order/src/main.js?sinpago')).default;
  process.env.MP_ACCESS_TOKEN = saved.t;
  r = await noPay(mk('u1', other({ paymentMethod: 'online' }))); check('sin configuración de pago -> 503 y no se crea pedido', r.s === 503 && store.orders.length === nBefore, r); }

// confirmar exige pago verificado
r = await ops(mk('staff1', { orderId: op.$id, status: 'confirmed' })); check('pedido en línea sin pago verificado no se confirma -> 409 payment_required', r.s === 409 && r.b.code === 'payment_required' && op.status === 'pending', r);
r = await ops(mk('u2', { action: 'syncPayment', orderId: op.$id })); check('otro cliente no verifica pagos ajenos -> 404', r.s === 404, r);
r = await ops(mk('drv1', { action: 'syncPayment', orderId: op.$id })); check('repartidor no verifica pagos -> 403', r.s === 403, r);
r = await ops(mk('u1', { action: 'syncPayment', orderId: cashId })); check('pedido en efectivo no tiene pago en línea -> 409', r.s === 409 && r.b.code === 'not_online', r);
net.mp.payments = [{ id: 111, status: 'pending', transaction_amount: 28.5, currency_id: 'MXN', date_created: '2026-10-23T10:00:00Z' }];
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('pago pendiente en Mercado Pago -> sigue pending', r.s === 200 && r.b.paymentStatus === 'pending' && r.b.providerStatus === 'pending' && op.paymentStatus === 'pending', r);
net.mp.payments = [{ id: 112, status: 'approved', transaction_amount: 1, currency_id: 'MXN', date_created: '2026-10-23T10:01:00Z' }];
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('pago aprobado por MENOS importe no se acepta', r.s === 200 && r.b.paymentStatus === 'pending' && op.paymentStatus === 'pending', r);
net.mp.payments = [{ id: 113, status: 'approved', transaction_amount: 28.5, currency_id: 'USD', date_created: '2026-10-23T10:02:00Z' }];
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('pago aprobado en otra moneda no se acepta', r.b.paymentStatus === 'pending', r);
net.mp.payments = [{ id: 114, status: 'approved', transaction_amount: 28.5, currency_id: 'MXN', date_created: '2026-10-23T10:03:00Z' }];
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('pago aprobado por el importe exacto -> paid', r.s === 200 && r.b.paymentStatus === 'paid' && op.paymentStatus === 'paid' && op.paymentId === '114', r);
net.calls.length = 0;
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('verificar de nuevo no vuelve a consultar a Mercado Pago', r.b.paymentStatus === 'paid' && net.calls.length === 0, r);
r = await ops(mk('u1', { orderId: op.$id, status: 'cancelled' })); check('el cliente no cancela un pedido ya pagado -> refund_needed', r.s === 409 || r.s === 403, r); check('(código)', r.b.code === 'refund_needed', r);
net.mp.payments = []; { const t = store.orders.find((o) => o.paymentMethod === 'online' && o.paymentStatus === 'pending' && o.$id !== op.$id); if (t) { r = await ops(mk('u1', { action: 'syncPayment', orderId: t.$id })); check('sin pagos en Mercado Pago -> pending', r.s === 200 && r.b.paymentStatus === 'pending' && r.b.providerStatus === null, r); } }
const failFetch = globalThis.fetch; globalThis.fetch = async (u, o) => (String(u).includes('payments/search') ? { ok: false, json: async () => ({}) } : failFetch(u, o));
{ const t = store.orders.find((o) => o.paymentMethod === 'online' && o.paymentStatus === 'pending'); if (t) { r = await ops(mk('u1', { action: 'syncPayment', orderId: t.$id })); check('si Mercado Pago no responde -> 502 y no cambia nada', r.s === 502 && t.paymentStatus === 'pending', r); } }
globalThis.fetch = failFetch;
r = await ops(mk('staff1', { action: 'listOrders' })); check('la vista de staff muestra método y estado de pago', r.b.orders.some((x) => x.paymentMethod === 'online' && x.paymentStatus === 'paid'), r.b.orders?.[0]);

// ---------- notificaciones push
net.calls.length = 0;
r = await ops(mk('staff1', { orderId: op.$id, status: 'confirmed' })); const pc = pushCalls();
check('pago verificado: el personal confirma', r.s === 200 && op.status === 'confirmed', r);
check('el cliente recibe push al confirmar (sin dirección ni teléfono)', pc.length === 1 && JSON.parse(pc[0].opts.body)[0].to === FIXEDTOK && JSON.parse(pc[0].opts.body)[0].title === 'Pedido confirmado' && !/Reforma|5512/.test(pc[0].opts.body), pc.map((c) => c.opts.body));
net.calls.length = 0;
const o3 = store.orders.find((o) => o.status === 'pending' && o.paymentMethod !== 'online' && o.userId === 'u1');
r = await ops(mk('u1', { orderId: o3.$id, status: 'cancelled' })); check('el cliente NO recibe push por su propia cancelación', r.s === 200 && pushCalls().length === 0, r);
net.calls.length = 0;
r = await ops(mk('staff1', { action: 'assignDriver', orderId: op.$id, driverUserId: 'drv2' })); const pd = pushCalls();
check('el repartidor recibe push al ser asignado', r.s === 200 && pd.length === 1 && JSON.parse(pd[0].opts.body)[0].to.includes('driver-token') && JSON.parse(pd[0].opts.body)[0].title === 'Nueva entrega asignada', pd.map((c) => c.opts.body));
net.calls.length = 0; net.expo.fail = true;
r = await ops(mk('staff1', { orderId: op.$id, status: 'preparing' })); check('si Expo Push falla, el cambio de estado igual se aplica', r.s === 200 && op.status === 'preparing', r);
net.expo.fail = false; net.expo.response = { data: [{ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }] };
r = await ops(mk('drv2', { orderId: op.$id, status: 'on_the_way' })); check('un dispositivo dado de baja se purga del perfil', r.s === 200 && store.users.find((u) => u.accountId === 'u1').pushToken === null, store.users[0]);
net.calls.length = 0;
r = await ops(mk('drv2', { orderId: op.$id, status: 'delivered' })); check('sin token guardado no se envía nada', r.s === 200 && pushCalls().length === 0, r);
store.users.find((u) => u.accountId === 'u1').pushToken = 'valor-raro';
net.calls.length = 0; { const t = store.orders.find((o) => o.userId === 'u1' && o.status === 'pending' && o.paymentMethod === 'cash_on_delivery'); if (t) { r = await ops(mk('staff1', { orderId: t.$id, status: 'confirmed' })); check('un token con formato inválido se ignora', r.s === 200 && pushCalls().length === 0, r); } }

console.log(`\n${ok} ok, ${bad} fallas`); process.exit(bad ? 1 : 0);
