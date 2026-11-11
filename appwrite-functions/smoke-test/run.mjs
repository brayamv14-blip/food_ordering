import { store } from 'node-appwrite';
import { createHmac } from 'node:crypto';
for (const [k, v] of Object.entries({ DATABASE_ID: 'db', ORDERS_TABLE_ID: 'orders', ORDER_ITEMS_TABLE_ID: 'items', MENU_TABLE_ID: 'menu', INVENTORY_MOVES_TABLE_ID: 'moves', CATEGORIES_TABLE_ID: 'cats', AUDIT_TABLE_ID: 'audit', AUTO_ASSIGN_DRIVER: 'false', CUSTOMIZATIONS_TABLE_ID: 'cust', MENU_CUSTOMIZATIONS_TABLE_ID: 'rel', ORDER_EVENTS_TABLE_ID: 'events', STRIPE_SECRET_KEY: 'sk_test_no_real_0000', STRIPE_WEBHOOK_SECRET: 'whsec_test_no_real', PAYMENT_RETURN_URL: 'https://equipo.github.io/delivery/pago.html' })) process.env[k] = v;

// ---- doble de fetch: API de Stripe (no hay red real). Respeta la clave de idempotencia como el servicio real.
const net = { calls: [], stripe: { sessions: {}, byKey: {}, refunds: {}, refundKeys: {}, createOk: true, refundOk: true, seq: 0 } };
globalThis.fetch = async (url, opts = {}) => {
  net.calls.push({ url: String(url), opts });
  const json = (b, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => b });
  const u = String(url); const S = net.stripe;
  if (!u.startsWith('https://api.stripe.com')) throw new Error('URL inesperada ' + url);
  const form = new URLSearchParams(opts.body || '');
  if (u.endsWith('/v1/checkout/sessions') && opts.method === 'POST') {
    if (!S.createOk) return json({ error: { message: 'boom' } }, false, 500);
    const key = opts.headers['Idempotency-Key'];
    if (key && S.byKey[key]) return json(S.sessions[S.byKey[key]]);
    const id = 'cs_test_' + String(++S.seq).padStart(6, '0');
    S.sessions[id] = { id, url: 'https://checkout.stripe.com/c/pay/' + id, status: 'open', payment_status: 'unpaid', client_reference_id: form.get('client_reference_id'),
      amount_total: Number(form.get('line_items[0][price_data][unit_amount]')), currency: form.get('line_items[0][price_data][currency]'),
      metadata: { orderId: form.get('metadata[orderId]'), userId: form.get('metadata[userId]') }, payment_intent: null, _form: Object.fromEntries(form) };
    if (key) S.byKey[key] = id;
    return json(S.sessions[id]);
  }
  let m = u.match(/\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
  if (m) { const s = S.sessions[m[1]]; if (!s) return json({}, false, 404); s.status = 'expired'; return json(s); }
  m = u.match(/\/v1\/checkout\/sessions\/([^/?]+)/);
  if (m && opts.method === 'GET') { const s = S.sessions[m[1]]; return s ? json(s) : json({}, false, 404); }
  if (u.endsWith('/v1/refunds') && opts.method === 'POST') {
    if (!S.refundOk) return json({ error: {} }, false, 500);
    const key = opts.headers['Idempotency-Key'];
    if (key && S.refundKeys[key]) return json(S.refundKeys[key]);
    const piId = form.get('payment_intent'); const sess = Object.values(S.sessions).find((x) => x.payment_intent === piId);
    const amount = form.get('amount') ? Number(form.get('amount')) : (sess ? sess.amount_total : 0);
    const already = Object.values(S.refunds).filter((x) => x.payment_intent === piId).reduce((a, x) => a + x.amount, 0);
    if (sess && already + amount > sess.amount_total) return json({ error: { message: 'exceeds' } }, false, 400);
    const refund = { id: 're_' + (++S.seq), status: 'succeeded', payment_intent: piId, amount };
    S.refunds[refund.id] = refund; if (key) S.refundKeys[key] = refund; return json(refund);
  }
  throw new Error('Llamada a Stripe inesperada ' + opts.method + ' ' + url);
};
// Simula que el cliente pago en Stripe Checkout (lo que normalmente hace la pagina alojada).
const payInStripe = (sessionId, { amount, currency } = {}) => { const s = net.stripe.sessions[sessionId]; s.status = 'complete'; s.payment_status = 'paid'; s.payment_intent = 'pi_' + sessionId; if (amount !== undefined) s.amount_total = amount; if (currency) s.currency = currency; return s; };
const createOrder = (await import('./create-order/src/main.js')).default;
const ops = (await import('./update-order-status/src/main.js')).default;
const hook = (await import('./stripe-webhook/src/main.js')).default;
const pushes = () => store.pushes;
const accept = (d, id) => ops(mk(d, { action: 'respondAssignment', orderId: id, accept: true }));
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
r = await ops(mk('staff2', { orderId: oid, status: 'cancelled', reason: 'prueba', expectedStatus: 'pending' })); check('segundo empleado con datos viejos -> 409 stale_order', r.s === 409 && r.b.code === 'stale_order' && o1.status === 'confirmed', r);
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
r = await ops(mk('drv1', { orderId: oid, status: 'on_the_way' })); check('sin aceptar la asignación no sale a reparto -> 409', r.s === 409 && r.b.code === 'assignment_pending', r);
r = await accept('drv1', oid); check('el repartidor acepta la asignación', r.s === 200 && o1.driverResponse === 'accepted', r);
r = await ops(mk('drv1', { orderId: oid, status: 'on_the_way' })); check('repartidor asignado sale a reparto', r.s === 200, r);
r = await ops(mk('u1', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('cliente no mueve al repartidor -> 403', r.s === 403 && !o1.driverLatitude, r);
r = await ops(mk('drv2', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('repartidor ajeno no actualiza ubicación -> 403', r.s === 403, r);
r = await ops(mk('drv1', { action: 'updateLocation', orderId: oid, latitude: 0, longitude: 0 })); check('0,0 rechazado', r.s === 400, r);
r = await ops(mk('drv1', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('repartidor asignado actualiza ubicación', r.s === 200 && o1.driverLatitude === 19.5, r);
r = await ops(mk('drv1', { action: 'updateLocation', orderId: oid, latitude: 19.51, longitude: -99.2 })); check('actualización inmediata -> 429', r.s === 429, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv2' })); check('no se reasigna a mitad del trayecto -> 409', r.s === 409 && r.b.code === 'in_transit' && o1.driverUserId === 'drv1', r);
r = await ops(mk('drv1', { orderId: oid, status: 'delivery_failed' })); check('entrega fallida del repartidor', r.s === 200 && o1.status === 'delivery_failed', r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv2' })); check('tras fallar, reasignar descarta ubicación anterior y pide aceptación', r.s === 200 && o1.driverLatitude === null && o1.driverResponse === 'pending', r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv2' })); check('misma asignación repetida no duplica', r.b.duplicate === true, r);
await accept('drv2', oid);
r = await ops(mk('drv2', { orderId: oid, status: 'on_the_way' })); check('reintento de entrega (repartidor asignado): delivery_failed -> on_the_way', r.s === 200 && o1.status === 'on_the_way', r);
r = await ops(mk('drv2', { orderId: oid, status: 'delivered' })); check('entregado por el nuevo repartidor', r.s === 200 && o1.status === 'delivered', r);
check('al terminar no se conserva ubicación', o1.driverLatitude === null);
r = await ops(mk('drv2', { action: 'updateLocation', orderId: oid, latitude: 19.5, longitude: -99.2 })); check('pedido entregado ya no acepta ubicación -> 409', r.s === 409, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: oid, driverUserId: 'drv1' })); check('pedido terminado no se reasigna -> 409', r.s === 409, r);
r = await ops(mk('staff1', { orderId: oid, status: 'cancelled', reason: 'prueba' })); check('entregado no se cancela', r.s === 409, r);

// ---------- historial
r = await ops(mk('staff1', { action: 'orderHistory', orderId: oid })); const types = r.b.events?.map((e) => e.type + ':' + (e.to ?? ''));
check('historial: creación, estados y asignaciones en orden', r.s === 200 && r.b.enabled && types[0] === 'created:pending' && types.includes('status:confirmed') && types.filter((t) => t.startsWith('driver_assigned')).length === 2 && types.at(-1) === 'status:delivered', types);
r = await ops(mk('u1', { action: 'orderHistory', orderId: oid })); check('cliente no ve el historial -> 403', r.s === 403, r);
store.failEvents = true; const o2 = store.orders.find((o) => o.status === 'pending' && o.$id !== oid);
r = await ops(mk('staff1', { orderId: o2.$id, status: 'confirmed' })); check('si el historial falla, el cambio de estado igual se aplica', r.s === 200 && o2.status === 'confirmed', r);
store.failEvents = false;


// ---------- pago en línea (Stripe Checkout)
r = await createOrder(mk('u1', other({ paymentMethod: 'bitcoin' }))); check('método de pago desconocido -> 400', r.s === 400 && r.b.code === 'bad_payment_method', r);
store.pushes.length = 0;
r = await createOrder(mk('u1', other())); check('pedido en efectivo: paymentStatus not_required', r.s === 200 && store.orders.find((o) => o.$id === r.b.orderId).paymentStatus === 'not_required' && !r.b.checkoutUrl, r);
const cashId = r.b.orderId;
check('pedido en efectivo: el cliente recibe "Pedido recibido"', pushes().length === 1 && pushes()[0].title === 'Pedido recibido' && pushes()[0].users[0] === 'u1' && pushes()[0].data.orderId === cashId, pushes());
net.calls.length = 0;
const onlineBody = other({ paymentMethod: 'online', items: [{ menuId: 'm2', quantity: 2, price: 0.01 }], total: 0.01 });
store.pushes.length = 0;
r = await createOrder(mk('u1', onlineBody)); const op = store.orders.find((o) => o.$id === r.b.orderId);
check('pago en línea: crea pedido pending y devuelve enlace de Stripe', r.s === 200 && op.paymentMethod === 'online' && op.paymentStatus === 'pending' && r.b.checkoutUrl?.startsWith('https://checkout.stripe.com/') && op.stripeSessionId?.startsWith('cs_test_'), r);
const sessCall = net.calls.find((c) => c.url.endsWith('/v1/checkout/sessions'));
const form = new URLSearchParams(sessCall.opts.body);
check('el importe lo calcula el servidor (24+5-0.5 = 2850 centavos), no el cliente', form.get('line_items[0][price_data][unit_amount]') === '2850' && form.get('line_items[0][price_data][currency]') === 'mxn' && form.get('client_reference_id') === op.$id && form.get('metadata[orderId]') === op.$id, Object.fromEntries(form));
check('la sesión se pide con la clave del servidor e idempotencia ligada al pedido', sessCall.opts.headers.Authorization === 'Bearer sk_test_no_real_0000' && sessCall.opts.headers['Idempotency-Key'] === `checkout-${op.$id}-1`);
check('las URL de retorno apuntan a la página de retorno con el pedido', form.get('success_url') === `https://equipo.github.io/delivery/pago.html?result=success&order=${op.$id}` && form.get('cancel_url').includes('result=cancelled'));
check('pago en línea pendiente: no se avisa "Pedido recibido" hasta cobrar', pushes().length === 0, pushes());
r = await createOrder(mk('u1', onlineBody)); check('reintento devuelve el mismo pedido sin crear otro cobro', r.b.duplicate === true && !r.b.checkoutUrl && store.orders.filter((o) => o.paymentMethod === 'online').length === 1, r);
const nBefore = store.orders.length; net.stripe.createOk = false;
r = await createOrder(mk('u1', other({ paymentMethod: 'online' }))); check('si Stripe falla -> 502 y no queda pedido huérfano', r.s === 502 && r.b.code === 'payment_unavailable' && store.orders.length === nBefore, r);
net.stripe.createOk = true;
{ const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const noPay = (await import('./create-order/src/main.js?sinpago')).default;
  process.env.STRIPE_SECRET_KEY = saved;
  r = await noPay(mk('u1', other({ paymentMethod: 'online' }))); check('sin configuración de pago -> 503 y no se crea pedido', r.s === 503 && store.orders.length === nBefore, r); }

// confirmar exige pago verificado
r = await ops(mk('staff1', { orderId: op.$id, status: 'confirmed' })); check('pedido en línea sin pago verificado no se confirma -> 409 payment_required', r.s === 409 && r.b.code === 'payment_required' && op.status === 'pending', r);
r = await ops(mk('u2', { action: 'syncPayment', orderId: op.$id })); check('otro cliente no verifica pagos ajenos -> 404', r.s === 404, r);
r = await ops(mk('drv1', { action: 'syncPayment', orderId: op.$id })); check('repartidor no verifica pagos -> 403', r.s === 403, r);
r = await ops(mk('u1', { action: 'syncPayment', orderId: cashId })); check('pedido en efectivo no tiene pago en línea -> 409', r.s === 409 && r.b.code === 'not_online', r);
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('sesión abierta sin pagar -> sigue pending', r.s === 200 && r.b.paymentStatus === 'pending' && r.b.providerStatus === 'unpaid' && op.paymentStatus === 'pending', r);
payInStripe(op.stripeSessionId, { amount: 100 });
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('cobro por MENOS importe no se acepta', r.s === 200 && r.b.paymentStatus === 'pending' && r.b.providerStatus === 'invalid' && op.paymentStatus === 'pending', r);
payInStripe(op.stripeSessionId, { amount: 2850, currency: 'usd' });
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('cobro en otra moneda no se acepta', r.b.paymentStatus === 'pending', r);
payInStripe(op.stripeSessionId, { amount: 2850, currency: 'mxn' });
store.pushes.length = 0;
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('cobro por el importe exacto -> paid (verificado en el servidor)', r.s === 200 && r.b.paymentStatus === 'paid' && op.paymentStatus === 'paid' && op.paymentId === 'pi_' + op.stripeSessionId, r);
check('al pagarse: push "Pago recibido" (una sola vez)', pushes().length === 1 && pushes()[0].title === 'Pago recibido' && pushes()[0].users[0] === 'u1', pushes());
net.calls.length = 0;
r = await ops(mk('u1', { action: 'syncPayment', orderId: op.$id })); check('verificar de nuevo no vuelve a consultar a Stripe ni a notificar', r.b.paymentStatus === 'paid' && net.calls.length === 0 && pushes().length === 1, r);
r = await ops(mk('u1', { orderId: op.$id, status: 'cancelled' })); check('el cliente no cancela un pedido ya pagado -> refund_needed', (r.s === 409 || r.s === 403) && r.b.code === 'refund_needed', r);
{ // sesión de OTRO pedido no sirve como prueba de pago
  const t = store.orders.find((o) => o.paymentMethod === 'online' && o.paymentStatus === 'pending' && o.$id !== op.$id);
  check('(sin otros pedidos en línea pendientes todavía)', !t); }
r = await ops(mk('staff1', { action: 'listOrders' })); check('la vista de staff muestra método y estado de pago', r.b.orders.some((x) => x.paymentMethod === 'online' && x.paymentStatus === 'paid'), r.b.orders?.[0]);

// ---------- reintento de pago (payOrder) y pedidos cancelados
store.pushes.length = 0;
r = await createOrder(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] }))); const o4 = store.orders.find((o) => o.$id === r.b.orderId);
r = await ops(mk('u2', { action: 'payOrder', orderId: o4.$id })); check('payOrder: otro cliente -> 404', r.s === 404, r);
r = await ops(mk('staff1', { action: 'payOrder', orderId: o4.$id })); check('payOrder: solo el dueño (el personal no) -> 404', r.s === 404, r);
net.calls.length = 0;
r = await ops(mk('u1', { action: 'payOrder', orderId: o4.$id })); check('payOrder: sesión abierta -> reutiliza el mismo enlace (sin otro cobro)', r.s === 200 && r.b.checkoutUrl === `https://checkout.stripe.com/c/pay/${o4.stripeSessionId}` && !net.calls.some((c) => c.opts.method === 'POST'), r);
const oldSession = o4.stripeSessionId; net.stripe.sessions[oldSession].status = 'expired';
r = await ops(mk('u1', { action: 'payOrder', orderId: o4.$id })); const newSession = o4.stripeSessionId;
check('payOrder: sesión vencida -> crea una nueva ligada a la anterior', r.s === 200 && newSession !== oldSession && r.b.checkoutUrl.endsWith(newSession), r);
r = await ops(mk('u1', { action: 'payOrder', orderId: o4.$id })); check('payOrder repetido devuelve la misma sesión', r.b.checkoutUrl.endsWith(newSession), r);
r = await ops(mk('u1', { action: 'syncPayment', orderId: o4.$id })); check('sesión vencida/abierta nueva sigue pendiente', r.b.paymentStatus === 'pending', r);
r = await ops(mk('u1', { orderId: o4.$id, status: 'cancelled' })); check('el cliente cancela un pedido en línea SIN pagar', r.s === 200 && o4.status === 'cancelled' && o4.paymentStatus === 'cancelled', r);
check('al cancelar sin pagar se cierra la sesión de Stripe', net.stripe.sessions[newSession].status === 'expired');
r = await ops(mk('u1', { action: 'payOrder', orderId: o4.$id })); check('un pedido cancelado ya no se puede pagar -> 409', r.s === 409 && r.b.code === 'not_payable', r);
check('cancelar sin pagar no emite reembolsos', Object.keys(net.stripe.refunds).length === 0);

// ---------- webhook de Stripe (firma verificada, idempotente)
const sign = (raw, { secret = 'whsec_test_no_real', t = Math.floor(Date.now() / 1000) } = {}) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const hk = (event, headers = {}, raw) => { const body = raw ?? JSON.stringify(event); return { req: { method: 'POST', headers: { 'x-appwrite-key': 'k', 'stripe-signature': sign(body), ...headers }, bodyText: body }, res: { json: (b, s = 200) => ({ s, b }) }, log(){}, error(){} }; };
const completed = (order, session, extra = {}) => ({ id: 'evt_' + Math.random().toString(36).slice(2), type: 'checkout.session.completed', data: { object: { ...session, ...extra, client_reference_id: order.$id } } });
r = await createOrder(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] }))); const o5 = store.orders.find((o) => o.$id === r.b.orderId);
const s5 = net.stripe.sessions[o5.stripeSessionId]; payInStripe(s5.id, { amount: 1050 }); // (10 + 5 - 0.5) = 14.5 => 1450
payInStripe(s5.id, { amount: 1450 });
let ev = completed(o5, s5);
r = await hook({ ...hk(ev), req: { ...hk(ev).req, headers: { 'x-appwrite-key': 'k' } } }); check('webhook sin firma -> 400', r.s === 400 && r.b.code === 'bad_signature', r);
r = await hook(hk(ev, { 'stripe-signature': sign(JSON.stringify(ev), { secret: 'whsec_otro' }) })); check('webhook con firma de otro secreto -> 400', r.s === 400 && o5.paymentStatus === 'pending', r);
r = await hook(hk(ev, { 'stripe-signature': sign(JSON.stringify(ev), { t: Math.floor(Date.now() / 1000) - 3600 }) })); check('webhook con firma vieja (repetición) -> 400 stale_event', r.s === 400 && r.b.code === 'stale_event' && o5.paymentStatus === 'pending', r);
r = await hook({ ...hk(ev), req: { ...hk(ev).req, bodyText: JSON.stringify(ev) + ' ' } }); check('cuerpo alterado tras firmar -> 400', r.s === 400 && o5.paymentStatus === 'pending', r);
r = await hook({ ...hk(ev), req: { ...hk(ev).req, method: 'GET' } }); check('webhook por GET -> 405', r.s === 405, r);
store.pushes.length = 0;
r = await hook(hk(ev)); check('webhook firmado: checkout.session.completed -> paid', r.s === 200 && o5.paymentStatus === 'paid' && o5.paymentId === 'pi_' + s5.id, [r, o5.paymentStatus]);
check('webhook: una sola notificación de pago', pushes().length === 1 && pushes()[0].title === 'Pago recibido', pushes());
r = await hook(hk(ev)); check('mismo evento repetido es idempotente (sin segunda notificación)', r.s === 200 && pushes().length === 1 && store.events.filter((e) => e.orderId === o5.$id && e.type === 'payment_paid').length === 1, store.events.filter((e) => e.orderId === o5.$id));
ev = completed(o5, s5, { amount_total: 1 });
r = await hook(hk(ev)); check('evento con importe alterado no cambia el pago', r.s === 200 && o5.paymentStatus === 'paid');
{ // importe distinto al del pedido en un pedido pendiente
  r = await createOrder(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] }))); const o6 = store.orders.find((o) => o.$id === r.b.orderId); const s6 = net.stripe.sessions[o6.stripeSessionId];
  payInStripe(s6.id, { amount: 100 });
  r = await hook(hk(completed(o6, s6))); check('webhook con importe menor al del pedido NO lo marca pagado', r.s === 200 && o6.paymentStatus === 'pending', [r, o6.paymentStatus]);
  r = await hook(hk({ id: 'evt_x', type: 'checkout.session.completed', data: { object: { ...s6, client_reference_id: o5.$id, amount_total: 1450, payment_status: 'paid', status: 'complete' } } })); check('sesión de otro pedido no sirve para pagar el actual', o6.paymentStatus === 'pending');
  r = await hook(hk({ id: 'evt_f', type: 'checkout.session.async_payment_failed', data: { object: { ...s6, client_reference_id: o6.$id } } })); check('async_payment_failed -> failed', o6.paymentStatus === 'failed', o6.paymentStatus);
  store.pushes.length = 0;
  r = await hook(hk({ id: 'evt_f2', type: 'checkout.session.async_payment_failed', data: { object: { ...s6, client_reference_id: o6.$id } } })); check('failed repetido no vuelve a notificar', pushes().length === 0);
  payInStripe(s6.id, { amount: 1450 });
  r = await hook(hk(completed(o6, s6))); check('un pago fallido puede reintentarse y pasar a paid', o6.paymentStatus === 'paid', o6.paymentStatus);
}
r = await hook(hk({ id: 'evt_u', type: 'customer.created', data: { object: {} } })); check('eventos no atendidos se ignoran con 200', r.s === 200 && r.b.ignored === true, r);
r = await hook(hk(completed({ $id: 'inexistente' }, s5))); check('pedido inexistente -> 200 (sin reintentos infinitos)', r.s === 200, r);
{ const saved = process.env.STRIPE_WEBHOOK_SECRET; delete process.env.STRIPE_WEBHOOK_SECRET;
  const noSecret = (await import('./stripe-webhook/src/main.js?sinsecreto')).default;
  process.env.STRIPE_WEBHOOK_SECRET = saved; r = await noSecret(hk(ev)); check('sin secreto de webhook configurado -> 503', r.s === 503, r); }

// ---------- reembolsos: cancelar un pedido pagado
store.pushes.length = 0;
r = await ops(mk('staff1', { orderId: o5.$id, status: 'cancelled', reason: 'prueba' })); const refundsAfterFirst = Object.keys(net.stripe.refunds).length;
check('el personal cancela un pedido pagado: se reembolsa y se cancela', r.s === 200 && o5.status === 'cancelled' && o5.paymentStatus === 'refunded' && refundsAfterFirst === 1, [r, o5.paymentStatus]);
check('reembolso con clave de idempotencia ligada al pedido', net.calls.filter((c) => c.url.endsWith('/v1/refunds')).every((c) => c.opts.headers['Idempotency-Key'] === `refund-${o5.$id}`));
check('el cliente recibe cancelación y reembolso (sin duplicados)', pushes().map((p) => p.title).join('|') === 'Pedido cancelado|Reembolso emitido', pushes().map((p) => p.title));
r = await ops(mk('staff1', { orderId: o5.$id, status: 'cancelled', reason: 'prueba' })); check('cancelar otra vez no reembolsa de nuevo', Object.keys(net.stripe.refunds).length === 1 && r.s >= 400, r);
r = await hook(hk({ id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', amount: 1450, amount_refunded: 1450, refunded: true, metadata: { orderId: o5.$id } } } })); check('webhook charge.refunded sobre pedido ya reembolsado es idempotente', r.s === 200 && o5.paymentStatus === 'refunded' && pushes().length === 2, pushes().map((p) => p.title));
{ // si el reembolso falla, el pedido NO se cancela
  r = await createOrder(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] }))); const o7 = store.orders.find((o) => o.$id === r.b.orderId); const s7 = net.stripe.sessions[o7.stripeSessionId];
  payInStripe(s7.id, { amount: 1450 }); await hook(hk(completed(o7, s7)));
  net.stripe.refundOk = false;
  r = await ops(mk('staff1', { orderId: o7.$id, status: 'cancelled', reason: 'prueba' })); check('si Stripe rechaza el reembolso, el pedido NO se cancela (502)', r.s === 502 && r.b.code === 'refund_failed' && o7.status === 'pending' && o7.paymentStatus === 'paid', r);
  net.stripe.refundOk = true;
  // pago tardío en un pedido ya cancelado
  r = await createOrder(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] }))); const o8 = store.orders.find((o) => o.$id === r.b.orderId); const s8 = net.stripe.sessions[o8.stripeSessionId];
  o8.status = 'cancelled'; o8.paymentStatus = 'cancelled'; // el cliente canceló y, a la vez, Stripe cobró
  payInStripe(s8.id, { amount: 1450 }); const before = Object.keys(net.stripe.refunds).length;
  r = await hook(hk(completed(o8, s8))); check('pago tardío sobre pedido cancelado -> se reembolsa solo, una vez', r.s === 200 && o8.paymentStatus === 'refunded' && Object.keys(net.stripe.refunds).length === before + 1, [r, o8.paymentStatus]);
  r = await hook(hk(completed(o8, s8))); check('...y repetir el evento no reembolsa otra vez', Object.keys(net.stripe.refunds).length === before + 1, Object.keys(net.stripe.refunds).length);
}

// ---------- notificaciones push (Appwrite Messaging)
store.pushes.length = 0;
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1 }] }))); const o9 = store.orders.find((o) => o.$id === r.b.orderId);
store.pushes.length = 0;
r = await ops(mk('staff1', { orderId: o9.$id, status: 'confirmed' }));
check('el cliente recibe push al confirmar (solo a su cuenta, sin dirección ni teléfono)', r.s === 200 && pushes().length === 1 && pushes()[0].users.length === 1 && pushes()[0].users[0] === 'u1' && pushes()[0].title === 'Pedido confirmado' && !/Reforma|5512/.test(JSON.stringify(pushes()[0])), pushes());
check('los valores de data son texto (requisito de FCM)', Object.values(pushes()[0].data).every((v) => typeof v === 'string') && pushes()[0].data.type === 'order_status' && pushes()[0].data.orderId === o9.$id);
store.pushes.length = 0;
const o10 = store.orders.find((o) => o.status === 'pending' && o.paymentMethod !== 'online' && o.userId === 'u1');
r = await ops(mk('u1', { orderId: o10.$id, status: 'cancelled' })); check('el cliente NO recibe push por su propia cancelación', r.s === 200 && pushes().length === 0, r);
store.pushes.length = 0;
r = await ops(mk('staff1', { action: 'assignDriver', orderId: o9.$id, driverUserId: 'drv2' })); await accept('drv2', o9.$id);
check('el repartidor recibe push al ser asignado (solo él)', r.s === 200 && pushes().length === 1 && pushes()[0].users[0] === 'drv2' && pushes()[0].title === 'Nueva entrega asignada', pushes());
store.pushes.length = 0; store.failPush = true;
r = await ops(mk('staff1', { orderId: o9.$id, status: 'preparing' })); check('si Messaging falla, el cambio de estado igual se aplica', r.s === 200 && o9.status === 'preparing', r);
store.failPush = false; store.pushes.length = 0;
r = await ops(mk('drv2', { orderId: o9.$id, status: 'on_the_way' })); check('en camino: aviso al cliente', pushes().length === 1 && pushes()[0].title === '¡Tu pedido va en camino!', pushes());
r = await ops(mk('drv2', { orderId: o9.$id, status: 'delivered' })); check('entregado: aviso al cliente', pushes().at(-1).title === 'Pedido entregado', pushes().map((p) => p.title));

// ---------- historial del repartidor y cobertura de entrega
r = await ops(mk('drv2', { action: 'myDeliveries', history: true })); check('el repartidor ve SU historial (entregados)', r.s === 200 && r.b.orders.some((x) => x.id === o9.$id && x.status === 'delivered'), r.b.orders?.map((x) => x.status));
r = await ops(mk('drv1', { action: 'myDeliveries', history: true })); check('el historial no incluye entregas de otro repartidor', r.s === 200 && !r.b.orders.some((x) => x.id === o9.$id), r.b.orders?.length);
r = await ops(mk('drv2', { action: 'myDeliveries' })); check('sin history solo se ven las activas', r.s === 200 && !r.b.orders.some((x) => x.status === 'delivered'));
r = await ops(mk('staff1', { action: 'listOrders' })); check('la vista de pedido incluye coordenadas de entrega para personal/repartidor', r.b.orders.some((x) => typeof x.deliveryLatitude === 'number'), r.b.orders?.[0]);
Object.assign(process.env, { RESTAURANT_LATITUDE: '19.5', RESTAURANT_LONGITUDE: '-99.2', DELIVERY_RADIUS_KM: '5' });
const ordersBefore = store.orders.length;
r = await createOrder(mk('u1', other())); check('con cobertura activa: dentro del radio -> se crea', r.s === 200, r);
r = await createOrder(mk('u1', other({ address: { line: 'Calle Lejana 999, Otra ciudad', label: 'manual', latitude: 19.9, longitude: -99.2 } }))); check('fuera del radio -> 422 out_of_coverage', r.s === 422 && r.b.code === 'out_of_coverage', r);
r = await createOrder(mk('u1', other({ address: { line: 'Calle Sin Coordenadas 123', label: 'manual', latitude: null, longitude: null } }))); check('sin coordenadas no se puede verificar -> 422 coverage_unverified', r.s === 422 && r.b.code === 'coverage_unverified', r);
check('los rechazados por cobertura no crean pedido', store.orders.length === ordersBefore + 1, store.orders.length - ordersBefore);
delete process.env.RESTAURANT_LATITUDE; delete process.env.RESTAURANT_LONGITUDE; delete process.env.DELIVERY_RADIUS_KM;
r = await createOrder(mk('u1', other({ address: { line: 'Calle Lejana 999, Otra ciudad', label: 'manual', latitude: 19.9, longitude: -99.2 } }))); check('sin cobertura configurada no se restringe nada', r.s === 200, r);

// ---------- listo para recoger, entrega fallida y tope de pedidos sin pagar
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1 }] }))); const o11 = store.orders.find((o) => o.$id === r.b.orderId);
await ops(mk('staff1', { orderId: o11.$id, status: 'confirmed' })); await ops(mk('staff1', { orderId: o11.$id, status: 'preparing' }));
await ops(mk('staff1', { action: 'assignDriver', orderId: o11.$id, driverUserId: 'drv1' })); await accept('drv1', o11.$id);
store.pushes.length = 0;
r = await ops(mk('drv1', { orderId: o11.$id, status: 'ready' })); check('el repartidor NO marca "listo para recoger" -> 403', r.s === 403 && o11.status === 'preparing', r);
r = await ops(mk('staff1', { orderId: o11.$id, status: 'ready' })); check('el personal marca listo para recoger', r.s === 200 && o11.status === 'ready', r);
check('el cliente recibe aviso "Tu pedido está listo"', pushes().at(-1)?.title === 'Tu pedido está listo', pushes().map((p) => p.title));
r = await ops(mk('drv1', { action: 'myDeliveries' })); check('un pedido listo aparece al repartidor asignado', r.b.orders.some((x) => x.id === o11.$id && x.status === 'ready'), r.b.orders?.map((x) => x.status));
r = await ops(mk('drv2', { orderId: o11.$id, status: 'on_the_way' })); check('otro repartidor no lo toma -> 403', r.s === 403, r);
r = await ops(mk('drv1', { orderId: o11.$id, status: 'on_the_way' })); check('desde listo sale a reparto el repartidor asignado', r.s === 200 && o11.status === 'on_the_way', r);
o11.driverLatitude = 19.5; o11.driverLongitude = -99.2;
r = await ops(mk('drv1', { orderId: o11.$id, status: 'delivery_failed' })); check('entrega fallida por el repartidor asignado', r.s === 200 && o11.status === 'delivery_failed', r);
check('al fallar se borra la ubicación del repartidor', o11.driverLatitude === null && o11.driverLongitude === null, [o11.driverLatitude]);
check('el cliente recibe aviso de entrega fallida', pushes().at(-1)?.title === 'No pudimos entregar tu pedido', pushes().map((p) => p.title));
r = await ops(mk('drv1', { orderId: o11.$id, status: 'delivered' })); check('de fallida no se pasa a entregado -> 409', r.s === 409 && o11.status === 'delivery_failed', r);
r = await ops(mk('drv1', { orderId: o11.$id, status: 'cancelled' })); check('el repartidor no cancela una entrega fallida', r.s === 403, r);
r = await ops(mk('u1', { orderId: o11.$id, status: 'cancelled' })); check('el cliente no cancela una entrega fallida', r.s === 403, r);
r = await ops(mk('staff1', { orderId: o11.$id, status: 'cancelled', reason: 'prueba' })); check('el personal cancela la entrega fallida', r.s === 200 && o11.status === 'cancelled', r);
r = await ops(mk('drv1', { action: 'updateLocation', orderId: o11.$id, latitude: 19.5, longitude: -99.2 })); check('no se acepta ubicación en pedido cancelado/fallido -> 409', r.s === 409, r);

// tope de pedidos en línea sin pagar
const online = () => other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] });
let last;
for (let i = 0; i < 12; i++) { last = await createOrder(mk('u9', online())); if (last.s !== 200) break; }
check('con 5 pedidos en línea sin pagar se rechaza el sexto -> 429', last.s === 429 && last.b.code === 'too_many_open_orders' && store.orders.filter((o) => o.userId === 'u9').length === 5, [last.s, store.orders.filter((o) => o.userId === 'u9').length]);
r = await createOrder(mk('u9', other({ items: [{ menuId: 'm1', quantity: 1 }] }))); check('el tope no bloquea pedidos en efectivo', r.s === 200, r);
r = await createOrder(mk('u8', online())); check('el tope es por usuario', r.s === 200, r);

// =====================================================================  V8
{
const admin = (await import('./admin-api/src/main.js')).default;
store.labels.adm1 = ['admin']; store.names.adm1 = 'Jefa'; store.labels.adm2 = ['admin']; store.names.adm2 = 'Jefe 2';
store.cats.push({ $id: 'cat1', name: 'Hamburguesas' });

// ---------- inventario
store.menu.push({ $id: 'inv1', name: 'Wrap', price: 8, stock: 5, lowStockThreshold: 2 }, { $id: 'inv2', name: 'Sin control', price: 3 });
const buy = (user, qty, extra = {}) => createOrder(mk(user, other({ items: [{ menuId: 'inv1', quantity: qty }], ...extra })));
const stock = () => store.menu.find((m) => m.$id === 'inv1').stock;
store.pushes.length = 0;
r = await buy('u1', 3); const iA = store.orders.find((o) => o.$id === r.b.orderId);
check('inventario: la compra descuenta existencias (5-3=2)', r.s === 200 && stock() === 2, [r.s, stock()]);
check('inventario: deja un movimiento "reserve"', store.moves.length === 1 && store.moves[0].type === 'reserve' && store.moves[0].delta === -3, store.moves);
check('inventario: cruzar el umbral avisa al personal (1 vez por empleado)', pushes().filter((p) => p.title === 'Existencias bajas').length >= 2, pushes().map((p) => p.title));
r = await buy('u1', 3); check('inventario: stock insuficiente -> 409 y no crea pedido', r.s === 409 && r.b.code === 'insufficient_stock' && stock() === 2, [r.s, r.b]);
const nBeforeInv = store.orders.length;
// compras simultaneas por las 2 unidades restantes: solo una puede ganar
const rs = await Promise.all([buy('u1', 2), buy('u2', 2), buy('u8', 2)]);
check('inventario: compras simultáneas, solo una gana y el stock nunca es negativo', rs.filter((x) => x.s === 200).length === 1 && stock() === 0 && rs.filter((x) => x.s === 409).length === 2, [rs.map((x) => x.s), stock()]);
check('inventario: las perdedoras no dejan pedidos huérfanos', store.orders.length === nBeforeInv + 1, store.orders.length - nBeforeInv);
r = await createOrder(mk('u1', other({ items: [{ menuId: 'inv2', quantity: 40 }] }))); check('inventario: producto sin control no se limita', r.s === 200, r);
r = await buy('u1', 1, { clientRequestId: iA.clientRequestId }); check('inventario: reintento del mismo intento no vuelve a descontar', r.b.duplicate === true && stock() === 0, [r.b, stock()]);
// cancelar devuelve; repetir no duplica
r = await ops(mk('u1', { orderId: iA.$id, status: 'cancelled' })); check('inventario: cancelar devuelve las existencias (0+3)', r.s === 200 && stock() === 3, [r.s, stock()]);
r = await ops(mk('staff1', { orderId: iA.$id, status: 'cancelled', reason: 'prueba' })); check('inventario: cancelar dos veces no devuelve dos veces', stock() === 3, stock());
check('inventario: movimiento "release" único', store.moves.filter((m) => m.orderId === iA.$id && m.type === 'release').length === 1, store.moves);
// falla al devolver: no deja constancia y se puede reintentar
r = await buy('u1', 1); const iB = store.orders.find((o) => o.$id === r.b.orderId);
store.failIncrement = true; r = await ops(mk('staff1', { orderId: iB.$id, status: 'cancelled', reason: 'prueba' })); store.failIncrement = false;
check('inventario: si la devolución falla, el pedido igual se cancela y no queda release', r.s === 200 && stock() === 2 && !store.moves.some((m) => m.orderId === iB.$id && m.type === 'release'), [r.s, stock()]);
r = await ops(mk('staff1', { orderId: iB.$id, status: 'cancelled', reason: 'prueba' })); check('inventario: cancelado ya no se puede cancelar de nuevo (409)', r.s === 409, r);
// reembolso (pedido en linea pagado) => cancelar devuelve stock una vez
store.menu.find((m) => m.$id === 'inv1').stock = 4; store.moves.length = 0;
r = await buy('u1', 2, { paymentMethod: 'online' }); const iC = store.orders.find((o) => o.$id === r.b.orderId);
check('inventario: pedido en línea sin pagar también reserva', r.s === 200 && stock() === 2, [r.s, stock()]);
payInStripe(iC.stripeSessionId, { amount: Math.round(iC.total * 100), currency: 'mxn' });
const sigHdr = (payload) => { const ts = Math.floor(Date.now() / 1000); return `t=${ts},v1=${createHmac('sha256', 'whsec_test_no_real').update(`${ts}.${payload}`).digest('hex')}`; };
const sendHook = (event) => { const raw = JSON.stringify(event); return hook({ req: { method: 'POST', headers: { 'stripe-signature': sigHdr(raw), 'x-appwrite-key': 'k' }, bodyText: raw }, res: { json: (b, s = 200) => ({ s, b }) }, log() {}, error() {} }); };
const sess = (id) => net.stripe.sessions[id];
r = await sendHook({ type: 'checkout.session.completed', data: { object: sess(iC.stripeSessionId) } }); check('pago: webhook marca pagado', iC.paymentStatus === 'paid', [r, iC.paymentStatus]);
r = await sendHook({ type: 'checkout.session.completed', data: { object: sess(iC.stripeSessionId) } }); check('pago: webhook repetido es idempotente', r.s === 200 && stock() === 2, [r, stock()]);
r = await ops(mk('staff1', { orderId: iC.$id, status: 'cancelled', reason: 'prueba' })); check('reembolso + cancelación devuelve stock una sola vez', r.s === 200 && iC.paymentStatus === 'refunded' && stock() === 4, [r, stock(), iC.paymentStatus]);
// sesion vencida => se cancela y libera
r = await buy('u2', 3, { paymentMethod: 'online' }); const iD = store.orders.find((o) => o.$id === r.b.orderId);
check('sesión vencida: reserva previa', stock() === 1, stock());
sess(iD.stripeSessionId).status = 'expired';
r = await sendHook({ type: 'checkout.session.expired', data: { object: sess(iD.stripeSessionId) } });
check('sesión vencida sin pago: cancela pedido, paymentStatus=cancelled y libera stock', r.s === 200 && iD.status === 'cancelled' && iD.paymentStatus === 'cancelled' && stock() === 4, [r, iD.status, stock()]);
r = await sendHook({ type: 'checkout.session.expired', data: { object: sess(iD.stripeSessionId) } }); check('sesión vencida repetida no libera dos veces', stock() === 4, stock());
r = await buy('u2', 1, { paymentMethod: 'online' }); const iE = store.orders.find((o) => o.$id === r.b.orderId);
const oldSession = { ...sess(iE.stripeSessionId), id: 'cs_test_vieja', status: 'expired' };
await sendHook({ type: 'checkout.session.expired', data: { object: oldSession } });
check('sesión vencida distinta de la vigente se ignora', iE.status === 'pending' && stock() === 3, [iE.status, stock()]);

// ---------- ciclo del repartidor
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1 }] }))); const d1 = store.orders.find((o) => o.$id === r.b.orderId);
await ops(mk('staff1', { orderId: d1.$id, status: 'confirmed' })); await ops(mk('staff1', { orderId: d1.$id, status: 'preparing' }));
r = await ops(mk('drv1', { action: 'setAvailability', available: false })); check('repartidor se marca no disponible', r.s === 200 && store.prefs.drv1.driverAvailable === false, r);
r = await ops(mk('u1', { action: 'setAvailability', available: true })); check('cliente no cambia disponibilidad -> 403', r.s === 403, r);
r = await ops(mk('staff1', { action: 'assignDriver', orderId: d1.$id, driverUserId: 'drv1' })); check('no se asigna a un repartidor no disponible -> 422', r.s === 422 && r.b.code === 'driver_unavailable', r);
r = await ops(mk('staff1', { action: 'listDrivers' })); check('listDrivers muestra disponibilidad y carga', r.b.drivers.find((d) => d.id === 'drv1').available === false && r.b.drivers.every((d) => typeof d.activeOrders === 'number'), r);
await ops(mk('drv1', { action: 'setAvailability', available: true }));
await ops(mk('staff1', { action: 'assignDriver', orderId: d1.$id, driverUserId: 'drv1' }));
r = await ops(mk('drv2', { action: 'respondAssignment', orderId: d1.$id, accept: true })); check('repartidor ajeno no responde la asignación -> 403', r.s === 403, r);
r = await ops(mk('u1', { action: 'respondAssignment', orderId: d1.$id, accept: true })); check('cliente no responde asignaciones -> 403', r.s === 403, r);
store.pushes.length = 0;
r = await ops(mk('drv1', { action: 'respondAssignment', orderId: d1.$id, accept: false })); check('rechazar libera el pedido y avisa al personal', r.s === 200 && !d1.driverUserId && d1.driverResponse === null && pushes().some((p) => p.title === 'Repartidor rechazó el pedido'), [r, pushes().map((p) => p.title)]);
r = await ops(mk('drv1', { orderId: d1.$id, status: 'picked_up' })); check('el que rechazó ya no opera el pedido -> 403', r.s === 403, r);
await ops(mk('staff1', { action: 'assignDriver', orderId: d1.$id, driverUserId: 'drv2' }));
r = await ops(mk('drv2', { orderId: d1.$id, status: 'picked_up' })); check('picked_up exige aceptar antes -> 409', r.s === 409 && r.b.code === 'assignment_pending', r);
await accept('drv2', d1.$id);
r = await accept('drv2', d1.$id); check('aceptar dos veces es idempotente', r.b.duplicate === true, r);
store.pushes.length = 0;
r = await ops(mk('drv2', { orderId: d1.$id, status: 'picked_up' })); check('recogido (picked_up) aviso al cliente', r.s === 200 && d1.status === 'picked_up' && pushes().at(-1)?.title === 'Tu pedido fue recogido', [r, pushes().map((p) => p.title)]);
r = await ops(mk('drv2', { action: 'updateLocation', orderId: d1.$id, latitude: 19.5, longitude: -99.2 })); check('en "recogido" aún no se comparte ubicación -> 409', r.s === 409, r);
r = await ops(mk('drv2', { action: 'respondAssignment', orderId: d1.$id, accept: false })); check('no se rechaza un pedido ya recogido -> 409', r.s === 409 && r.b.code === 'in_transit', r);
r = await ops(mk('drv2', { orderId: d1.$id, status: 'delivered' })); check('de recogido no se entrega directo -> 409', r.s === 409, r);
r = await ops(mk('drv2', { orderId: d1.$id, status: 'on_the_way' })); check('picked_up -> on_the_way', r.s === 200 && d1.status === 'on_the_way', r);
r = await ops(mk('drv2', { orderId: d1.$id, status: 'cancelled' })); check('el repartidor no cancela (rechazado y el estado no cambia)', r.s >= 400 && d1.status === 'on_the_way', r);
r = await ops(mk('drv2', { orderId: d1.$id, status: 'delivered' })); check('entrega completada', r.s === 200 && d1.status === 'delivered', r);
r = await ops(mk('drv2', { action: 'myDeliveries', history: true })); check('historial personal incluye lo entregado', r.b.orders.some((o) => o.id === d1.$id || o.orderId === d1.$id || o.$id === d1.$id), r);

// asignacion automatica (configurable)
process.env.AUTO_ASSIGN_DRIVER = 'true';
const opsAuto = (await import('./update-order-status/src/main.js?auto')).default;
r = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1 }] }))); const d2 = store.orders.find((o) => o.$id === r.b.orderId);
await opsAuto(mk('staff1', { orderId: d2.$id, status: 'confirmed' }));
store.prefs.drv1 = { driverAvailable: false };
await opsAuto(mk('staff1', { orderId: d2.$id, status: 'preparing' }));
check('auto-asignación elige al repartidor disponible', d2.driverUserId === 'drv2' && d2.driverResponse === 'pending', [d2.driverUserId, d2.driverResponse]);
r = await opsAuto(mk('drv2', { action: 'respondAssignment', orderId: d2.$id, accept: false }));
check('si rechaza y nadie más está disponible, queda sin asignar y se avisa al personal', !d2.driverUserId && r.b.reassigned === false, [d2.driverUserId, r.b]);
store.prefs.drv1 = { driverAvailable: true };
await opsAuto(mk('drv2', { action: 'setAvailability', available: false }));
r = await ops(mk('staff1', { orderId: d2.$id, status: 'ready' }));
r = await opsAuto(mk('staff1', { action: 'assignDriver', orderId: d2.$id, driverUserId: 'drv1' })); check('asignación manual sigue disponible con auto-asignación', r.s === 200 && d2.driverUserId === 'drv1', r);
process.env.AUTO_ASSIGN_DRIVER = 'false';

// ---------- admin-api
r = await admin(mk(null, { action: 'listProducts' })); check('admin: sin sesión -> 401', r.s === 401, r);
r = await admin(mk('u1', { action: 'listProducts' })); check('admin: cliente -> 403', r.s === 403, r);
r = await admin(mk('drv1', { action: 'report' })); check('admin: repartidor -> 403', r.s === 403, r);
r = await admin(mk('staff1', { action: 'listProducts' })); check('staff lista productos con stock y alertas', r.s === 200 && r.b.products.some((p) => p.id === 'inv1' && p.tracked) && r.b.products.some((p) => p.id === 'm3' && p.available === false), r);
r = await admin(mk('staff1', { action: 'saveProduct', product: { name: 'X', price: 1 } })); check('staff NO crea productos -> 403', r.s === 403, r);
r = await admin(mk('adm1', { action: 'saveProduct', product: { name: 'Taco', price: 25.5, image_url: 'https://cdn.ejemplo.test/t.png', categories: 'cat1', stock: 10 } })); const taco = r.b.product;
check('admin crea producto (con stock inicial y movimiento)', r.s === 200 && taco && taco.stock === 10 && store.moves.some((m) => m.menuId === taco.id && m.type === 'initial'), r);
r = await admin(mk('adm1', { action: 'saveProduct', product: { name: 'Malo', price: -5 } })); check('admin: precio negativo -> 422', r.s === 422 && r.b.code === 'bad_product', r);
r = await admin(mk('adm1', { action: 'saveProduct', product: { name: 'Malo', price: 5, image_url: 'javascript:alert(1)' } })); check('admin: imagen no https -> 422', r.s === 422, r);
r = await admin(mk('adm1', { action: 'saveProduct', product: { name: 'Malo', price: 5, categories: 'noexiste' } })); check('admin: categoría inexistente -> 422', r.s === 422, r);
r = await admin(mk('adm1', { action: 'saveProduct', product: { name: 'Malo', price: 5, isAdmin: true, $permissions: ['any'] } })); check('admin: campos no permitidos se ignoran (lista blanca)', r.s === 200 && !('isAdmin' in store.menu.at(-1)) && !('$permissions' in store.menu.at(-1)), store.menu.at(-1));
r = await admin(mk('adm1', { action: 'saveProduct', productId: taco.id, product: { price: 30, stock: 999 } })); check('admin edita precio; el stock no se cambia por saveProduct', r.s === 200 && r.b.product.price === 30 && r.b.product.stock === 10, r);
r = await createOrder(mk('u1', other({ items: [{ menuId: taco.id, quantity: 1, price: 1 }] }))); check('el nuevo precio rige en los pedidos (30+5-0.5)', r.s === 200 && store.orders.find((o) => o.$id === r.b.orderId).total === 34.5, r);
r = await admin(mk('staff1', { action: 'setProductAvailability', productId: taco.id, available: false })); check('staff desactiva producto', r.s === 200 && r.b.product.available === false, r);
r = await createOrder(mk('u1', other({ items: [{ menuId: taco.id, quantity: 1 }] }))); check('producto desactivado no se puede pedir', r.s === 422 && r.b.code === 'unavailable', r);
r = await admin(mk('staff1', { action: 'adjustStock', productId: taco.id, delta: -50 })); check('ajuste que dejaría stock negativo -> 422', r.s === 422, r);
r = await admin(mk('staff1', { action: 'adjustStock', productId: taco.id, delta: 5, reason: 'compra', clientRequestId: 'adj_00000001' })); check('staff suma stock (9+5=14)', r.s === 200 && r.b.product.stock === 14, r);
r = await admin(mk('staff1', { action: 'adjustStock', productId: taco.id, delta: 5, reason: 'compra', clientRequestId: 'adj_00000001' })); check('ajuste repetido con el mismo id no se aplica dos veces', r.b.duplicate === true && r.b.product.stock === 14, r);
r = await admin(mk('staff1', { action: 'stockMovements', productId: taco.id })); check('historial de movimientos del producto', r.s === 200 && r.b.movements.length >= 3, r);
r = await admin(mk('staff1', { action: 'listUsers' })); check('staff no lista usuarios -> 403', r.s === 403, r);
r = await admin(mk('u1', { action: 'setRole', userId: 'u1', labels: ['admin'] })); check('cliente no puede darse admin -> 403', r.s === 403 && !store.labels.u1.includes('admin'), r);
r = await admin(mk('staff1', { action: 'setRole', userId: 'u1', labels: ['admin'] })); check('staff no cambia roles -> 403', r.s === 403, r);
r = await admin(mk('adm1', { action: 'listUsers', query: 'Bryan' })); check('admin lista/busca usuarios', r.s === 200 && r.b.users.some((u) => u.id === 'u1'), r);
r = await admin(mk('adm1', { action: 'setRole', userId: 'u1', labels: ['superuser'] })); check('rol desconocido -> 422', r.s === 422, r);
r = await admin(mk('adm1', { action: 'setRole', userId: 'u1', labels: ['staff'] })); check('admin asigna rol staff', r.s === 200 && store.labels.u1.includes('staff'), r);
store.labels.u1 = [];
r = await admin(mk('adm1', { action: 'setRole', userId: 'adm1', labels: ['staff'] })); check('admin no se quita su propio rol -> 422', r.s === 422 && r.b.code === 'self_demote', r);
r = await admin(mk('adm1', { action: 'setRole', userId: 'adm2', labels: [] })); check('con 2 admins se puede quitar a otro', r.s === 200, r);
store.labels.adm2 = ['admin'];
const solo = store.labels.adm2; store.labels.adm2 = [];
r = await admin(mk('adm1', { action: 'setRole', userId: 'adm1', labels: ['staff'] }));
store.labels.adm2 = solo;
r = await admin(mk('staff1', { action: 'listPayments' })); check('pagos: lista solo pedidos en línea sin exponer el id completo de Stripe', r.s === 200 && r.b.payments.length > 0 && r.b.payments.every((p) => !p.reference || p.reference.startsWith('…')), r);
r = await admin(mk('staff1', { action: 'listPayments', paymentStatus: 'inventado' })); check('pagos: estado inválido -> 400', r.s === 400, r);
r = await admin(mk('staff1', { action: 'listPayments', paymentStatus: 'refunded' })); check('pagos: filtra por estado', r.s === 200 && r.b.payments.every((p) => p.paymentStatus === 'refunded') && r.b.payments.length >= 1, r);
r = await admin(mk('staff1', { action: 'report', format: 'csv' }));
const rp = r.b.report;
const realDelivered = store.orders.filter((o) => o.status === 'delivered');
check('reporte: ventas = suma de entregados reales', r.s === 200 && rp.delivered === realDelivered.length && Math.abs(rp.sales - realDelivered.reduce((a, o) => a + o.total, 0)) < 0.005, [rp.sales, realDelivered.length]);
check('reporte: cancelaciones y tasa', rp.cancelled === store.orders.filter((o) => o.status === 'cancelled').length && rp.cancellationRate > 0, rp);
check('reporte: productos más vendidos salen de los artículos entregados', rp.topProducts.length > 0 && rp.topProducts[0].quantity >= 1, rp.topProducts);
check('reporte: CSV con encabezado y una fila por pedido', r.b.csv.split('\n').length === store.orders.length + 1 && r.b.csv.startsWith('pedido,fecha,estado'), r.b.csv.split('\n').length);
r = await admin(mk('staff1', { action: 'report', from: 'no-es-fecha' })); check('reporte: fecha inválida -> 400', r.s === 400, r);
r = await admin(mk('staff1', { action: 'borrarTodo' })); check('admin: acción desconocida -> 400', r.s === 400, r);

}

// =====================================================================  V9 (auditoria de v8)
{
const admin = (await import('./admin-api/src/main.js')).default;
const sigHdr = (payload) => { const ts = Math.floor(Date.now() / 1000); return `t=${ts},v1=${createHmac('sha256', 'whsec_test_no_real').update(`${ts}.${payload}`).digest('hex')}`; };
const sendHook = (event, hdr) => { const raw = JSON.stringify(event); return hook({ req: { method: 'POST', headers: { 'stripe-signature': hdr ?? sigHdr(raw), 'x-appwrite-key': 'k' }, bodyText: raw }, res: { json: (b, s = 200) => ({ s, b }) }, log() {}, error() {} }); };
const sess = (id) => net.stripe.sessions[id];
const stockOf = (id) => store.menu.find((m) => m.$id === id).stock;
const movesOf = (orderId, type) => store.moves.filter((m) => m.orderId === orderId && (!type || m.type === type));
const mkOrder = (user, items, extra = {}) => createOrder(mk(user, other({ items, ...extra })));
const orderRow = (r) => store.orders.find((o) => o.$id === r.b.orderId);
store.menu.push({ $id: 'v9a', name: 'Arepa', price: 6, stock: 3, lowStockThreshold: 0 }, { $id: 'v9b', name: 'Bowl', price: 9, stock: 4, lowStockThreshold: 0 });
store.labels.adm9 = ['admin']; store.names.adm9 = 'Admin9';
store.prefs = {}; // disponibilidad de pruebas anteriores

// ---- inventario: ultima unidad, con columna que rechaza (min 0) y con columna que admite negativos
for (const [label, min0] of [['columna con mínimo 0', true], ['columna que admite negativos', false]]) {
  store.columnMin0 = min0; store.menu.find((m) => m.$id === 'v9a').stock = 1;
  const rs = await Promise.all([mkOrder('u1', [{ menuId: 'v9a', quantity: 1 }]), mkOrder('u2', [{ menuId: 'v9a', quantity: 1 }]), mkOrder('u8', [{ menuId: 'v9a', quantity: 1 }])]);
  check(`última unidad (${label}): exactamente una compra gana y el stock queda en 0`, rs.filter((x) => x.s === 200).length === 1 && rs.filter((x) => x.s === 409).length === 2 && stockOf('v9a') === 0, [rs.map((x) => x.s), stockOf('v9a')]);
}
store.columnMin0 = true;
store.menu.find((m) => m.$id === 'v9a').stock = -3;
let r9 = await mkOrder('u1', [{ menuId: 'v9a', quantity: 1 }]);
check('stock negativo en la base se trata como agotado (no como ventas ilimitadas)', r9.s === 409 && r9.b.code === 'insufficient_stock', r9);
store.menu.find((m) => m.$id === 'v9a').stock = 3;

// ---- inventario: fallo a mitad de la reserva (2 productos)
store.menu.find((m) => m.$id === 'v9b').stock = 4; store.moves.length = 0;
const ordersBefore = store.orders.length;
store.failDecrementFor = 'v9b';
r9 = await mkOrder('u1', [{ menuId: 'v9a', quantity: 2 }, { menuId: 'v9b', quantity: 1 }]);
store.failDecrementFor = null;
check('fallo en el 2.º producto: 500, sin pedido y el 1.º se devuelve', r9.s === 500 && store.orders.length === ordersBefore && stockOf('v9a') === 3 && stockOf('v9b') === 4, [r9.s, stockOf('v9a'), stockOf('v9b')]);
check('el historial reconstruye lo ocurrido (reserva + devolución del mismo pedido)', store.moves.length === 2 && store.moves[0].type === 'reserve' && store.moves[1].type === 'release' && store.moves[0].orderId === store.moves[1].orderId, store.moves);
// ... y si ademas la devolucion falla, la reserva queda registrada y la reconciliacion la repara
store.moves.length = 0;
store.failDecrementFor = 'v9b'; store.failIncrement = true;
r9 = await mkOrder('u1', [{ menuId: 'v9a', quantity: 2 }, { menuId: 'v9b', quantity: 1 }]);
store.failDecrementFor = null; store.failIncrement = false;
check('si la devolución también falla, el stock queda retenido pero con huella (reserva sin devolución)', r9.s === 500 && stockOf('v9a') === 1 && movesOf(store.moves[0]?.orderId, 'reserve').length === 1 && !store.moves.some((m) => m.type === 'release'), [r9.s, stockOf('v9a'), store.moves]);
r9 = await admin(mk('staff1', { action: 'reconcileInventory' })); check('el personal no puede reconciliar -> 403', r9.s === 403, r9);
r9 = await admin(mk('adm9', { action: 'reconcileInventory' })); check('la reconciliación devuelve la reserva huérfana', r9.s === 200 && r9.b.orphanOrders === 1 && stockOf('v9a') === 3, [r9, stockOf('v9a')]);
r9 = await admin(mk('adm9', { action: 'reconcileInventory' })); check('reconciliar de nuevo no devuelve dos veces', r9.b.orphanOrders === 0 && stockOf('v9a') === 3, [r9, stockOf('v9a')]);

// ---- mismo intento enviado dos veces a la vez
store.moves.length = 0;
const dupBody = other({ items: [{ menuId: 'v9a', quantity: 1 }] });
const dups = await Promise.all([createOrder(mk('u1', dupBody)), createOrder(mk('u1', dupBody))]);
check('dos solicitudes simultáneas del mismo intento: un solo pedido y un solo descuento', dups.every((x) => x.s === 200) && dups[0].b.orderId === dups[1].b.orderId && stockOf('v9a') === 2 && store.orders.filter((o) => o.clientRequestId === dupBody.clientRequestId).length === 1, [dups.map((x) => x.b), stockOf('v9a')]);
check('...y la copia perdedora devolvió su reserva (historial neto = 1 unidad)', store.moves.reduce((s, m) => s + m.delta, 0) === -1, store.moves);

// ---- cancelar con fallo de devolucion: el pedido se cancela, se avisa y la reconciliación lo repara
r9 = await mkOrder('u2', [{ menuId: 'v9a', quantity: 2 }]); const c1 = orderRow(r9);
check('pedido guarda stockReserved=true', c1.stockReserved === true && stockOf('v9a') === 0, [c1.stockReserved, stockOf('v9a')]);
store.failIncrement = true;
r9 = await ops(mk('staff1', { orderId: c1.$id, status: 'cancelled', reason: 'prueba' }));
store.failIncrement = false;
check('devolución fallida al cancelar: 200 con stockRelease=pending y evento de aviso', r9.s === 200 && r9.b.stockRelease === 'pending' && c1.status === 'cancelled' && stockOf('v9a') === 0 && store.events.some((e) => e.orderId === c1.$id && e.type === 'stock_release_failed'), [r9, stockOf('v9a')]);
r9 = await admin(mk('adm9', { action: 'reconcileInventory' })); check('la reconciliación devuelve el stock del pedido cancelado', r9.b.releasedOrders === 1 && stockOf('v9a') === 2, [r9, stockOf('v9a')]);

// ---- configuracion inconsistente: la Function que cancela no tiene INVENTORY_MOVES_TABLE_ID
r9 = await mkOrder('u2', [{ menuId: 'v9a', quantity: 1 }]); const c2 = orderRow(r9);
process.env.INVENTORY_MOVES_TABLE_ID = '';
const opsNoInv = (await import('./update-order-status/src/main.js?sininventario')).default;
const hookNoInv = (await import('./stripe-webhook/src/main.js?sininventario')).default;
process.env.INVENTORY_MOVES_TABLE_ID = 'moves';
r9 = await opsNoInv(mk('staff1', { orderId: c2.$id, status: 'cancelled', reason: 'prueba' }));
check('sin INVENTORY_MOVES_TABLE_ID no se cancela un pedido con stock reservado (503) y nada cambia', r9.s === 503 && r9.b.code === 'inventory_unavailable' && c2.status === 'pending' && stockOf('v9a') === 1, [r9, c2.status]);
r9 = await ops(mk('staff1', { orderId: c2.$id, status: 'cancelled', reason: 'prueba' })); check('con la configuración correcta sí se cancela y devuelve', r9.s === 200 && stockOf('v9a') === 2, [r9, stockOf('v9a')]);

// ---- entrega fallida / reintento / cancelacion: devuelve una sola vez
r9 = await mkOrder('u1', [{ menuId: 'v9b', quantity: 2 }]); const f1 = orderRow(r9);
await ops(mk('staff1', { orderId: f1.$id, status: 'confirmed' })); await ops(mk('staff1', { orderId: f1.$id, status: 'preparing' }));
await ops(mk('staff1', { action: 'assignDriver', orderId: f1.$id, driverUserId: 'drv2' })); await accept('drv2', f1.$id);
await ops(mk('drv2', { orderId: f1.$id, status: 'picked_up' }));
r9 = await ops(mk('drv2', { orderId: f1.$id, status: 'delivery_failed' })); check('desde "recogido" el repartidor puede reportar fallo (sin callejón)', r9.s === 200 && f1.status === 'delivery_failed', r9);
check('fallar la entrega NO devuelve stock', stockOf('v9b') === 2, stockOf('v9b'));
r9 = await ops(mk('drv2', { orderId: f1.$id, status: 'on_the_way' })); check('reintento de entrega no mueve stock', r9.s === 200 && stockOf('v9b') === 2, [r9, stockOf('v9b')]);
await ops(mk('drv2', { orderId: f1.$id, status: 'delivery_failed' }));
r9 = await ops(mk('drv2', { orderId: f1.$id, status: 'cancelled' })); check('el repartidor no cancela', r9.s >= 400 && f1.status === 'delivery_failed', r9);
r9 = await ops(mk('staff1', { orderId: f1.$id, status: 'cancelled', reason: 'prueba' })); check('el personal cancela tras el fallo: devuelve una vez', r9.s === 200 && stockOf('v9b') === 4, [r9, stockOf('v9b')]);
r9 = await ops(mk('staff1', { orderId: f1.$id, status: 'cancelled', reason: 'prueba' })); check('cancelar otra vez es 409 y no devuelve de nuevo', r9.s === 409 && stockOf('v9b') === 4, [r9, stockOf('v9b')]);
r9 = await mkOrder('u1', [{ menuId: 'v9b', quantity: 1 }]); const f2 = orderRow(r9);
for (const s of ['confirmed', 'preparing']) await ops(mk('staff1', { orderId: f2.$id, status: s }));
await ops(mk('staff1', { action: 'assignDriver', orderId: f2.$id, driverUserId: 'drv2' })); await accept('drv2', f2.$id);
await ops(mk('drv2', { orderId: f2.$id, status: 'on_the_way' })); await ops(mk('drv2', { orderId: f2.$id, status: 'delivered' }));
check('entregar no devuelve stock', f2.status === 'delivered' && stockOf('v9b') === 3, stockOf('v9b'));
r9 = await ops(mk('staff1', { orderId: f2.$id, status: 'cancelled', reason: 'prueba' })); check('un pedido entregado no se cancela (sin devolución)', r9.s === 409 && stockOf('v9b') === 3, r9);

// ---- Stripe: eventos fuera de orden, duplicados y pago tardio
r9 = await mkOrder('u1', [{ menuId: 'v9b', quantity: 1 }], { paymentMethod: 'online' }); const s1 = orderRow(r9);
payInStripe(s1.stripeSessionId, { amount: Math.round(s1.total * 100), currency: 'mxn' });
const refundedEvt = { type: 'charge.refunded', data: { object: { refunded: true, amount: 100, amount_refunded: 100, metadata: { orderId: s1.$id } } } };
const paidEvt = { type: 'checkout.session.completed', data: { object: sess(s1.stripeSessionId) } };
store.pushes.length = 0;
r9 = await sendHook(refundedEvt);
check('reembolso que llega ANTES del pago: pago=refunded, pedido cancelado y stock devuelto', r9.s === 200 && s1.paymentStatus === 'refunded' && s1.status === 'cancelled' && stockOf('v9b') === 3, [r9, s1.paymentStatus, s1.status, stockOf('v9b')]);
r9 = await sendHook(paidEvt); check('el pago tardío NO revierte un reembolso (sin pasar a paid)', s1.paymentStatus === 'refunded' && s1.status === 'cancelled', [s1.paymentStatus, s1.status]);
const pushesAfter = store.pushes.length;
await sendHook(refundedEvt); await sendHook(refundedEvt); await sendHook(paidEvt);
check('eventos duplicados no repiten notificaciones ni devoluciones', store.pushes.length === pushesAfter && stockOf('v9b') === 3, [store.pushes.length, pushesAfter, stockOf('v9b')]);

r9 = await mkOrder('u1', [{ menuId: 'v9b', quantity: 1 }], { paymentMethod: 'online' }); const s2 = orderRow(r9);
sess(s2.stripeSessionId).status = 'expired';
const expiredEvt = { type: 'checkout.session.expired', data: { object: sess(s2.stripeSessionId) } };
store.failIncrement = true; r9 = await sendHook(expiredEvt); store.failIncrement = false;
check('vencida + devolución fallida: 500 (Stripe reintentará) y el pedido ya está cancelado', r9.s === 500 && s2.status === 'cancelled' && stockOf('v9b') === 2, [r9, s2.status, stockOf('v9b')]);
r9 = await sendHook(expiredEvt); check('el REINTENTO de Stripe completa la devolución pendiente', r9.s === 200 && stockOf('v9b') === 3, [r9, stockOf('v9b')]);
r9 = await sendHook(expiredEvt); check('...y un segundo reintento no devuelve otra vez', stockOf('v9b') === 3, stockOf('v9b'));
// pago real llega tras cancelar por vencimiento => reembolso unico, sin tocar stock
const refundsBefore = Object.keys(net.stripe.refunds).length;
payInStripe(s2.stripeSessionId, { amount: Math.round(s2.total * 100), currency: 'mxn' }); sess(s2.stripeSessionId).status = 'complete';
const lateEvt = { type: 'checkout.session.completed', data: { object: sess(s2.stripeSessionId) } };
await sendHook(lateEvt); await sendHook(lateEvt);
check('pago tardío sobre pedido cancelado: un solo reembolso, pago=refunded y stock intacto', Object.keys(net.stripe.refunds).length === refundsBefore + 1 && s2.paymentStatus === 'refunded' && stockOf('v9b') === 3, [Object.keys(net.stripe.refunds).length - refundsBefore, s2.paymentStatus, stockOf('v9b')]);
r9 = await sendHook(paidEvt, 't=1,v1=00'); check('webhook con firma falsa -> 400', r9.s === 400, r9);
// el cliente no puede declararse pagado
r9 = await createOrder(mk('u1', other({ items: [{ menuId: 'v9b', quantity: 1 }], paymentMethod: 'online', paymentStatus: 'paid', status: 'delivered', stockReserved: false, total: 0.01 }))); const s3 = orderRow(r9);
check('el cliente no puede fijar paymentStatus, status, total ni stockReserved', s3.paymentStatus === 'pending' && s3.status === 'pending' && s3.total > 1 && s3.stockReserved === true, [s3.paymentStatus, s3.status, s3.total, s3.stockReserved]);
r9 = await ops(mk('u1', { action: 'syncPayment', orderId: s3.$id })); check('syncPayment con la sesión sin pagar no marca pagado', s3.paymentStatus === 'pending', [r9, s3.paymentStatus]);
r9 = await ops(mk('u1', { orderId: s3.$id, status: 'confirmed' })); check('el cliente no confirma su pedido (rechazado y sin cambio)', r9.s >= 400 && s3.status === 'pending', r9);
r9 = await ops(mk('staff1', { orderId: s3.$id, status: 'confirmed' })); check('ni el personal confirma un pedido en línea sin pagar (payment_required)', r9.s === 409 && r9.b.code === 'payment_required', r9);

// ---- repartidores: concurrencia y pedidos terminados
r9 = await mkOrder('u1', [{ menuId: 'm1', quantity: 1 }]); const a1 = orderRow(r9);
for (const s of ['confirmed', 'preparing']) await ops(mk('staff1', { orderId: a1.$id, status: s }));
store.pushes.length = 0;
const asg = await Promise.all([ops(mk('staff1', { action: 'assignDriver', orderId: a1.$id, driverUserId: 'drv1' })), ops(mk('staff2', { action: 'assignDriver', orderId: a1.$id, driverUserId: 'drv2' }))]);
check('asignación simultánea a dos repartidores: solo una gana, la otra recibe 409', asg.filter((x) => x.s === 200).length === 1 && asg.filter((x) => x.s === 409 && x.b.code === 'assignment_conflict').length === 1, asg.map((x) => [x.s, x.b.code]));
const winner = asg.find((x) => x.s === 200).b;
check('el pedido queda con un solo repartidor y solo él fue notificado', ['drv1', 'drv2'].includes(a1.driverUserId) && pushes().filter((p) => p.title === 'Nueva entrega asignada').length === 1 && pushes().find((p) => p.title === 'Nueva entrega asignada').users[0] === a1.driverUserId, [a1.driverUserId, pushes().map((p) => p.users)]);
const loser = a1.driverUserId === 'drv1' ? 'drv2' : 'drv1';
const acc = await Promise.all([accept(a1.driverUserId, a1.$id), accept(loser, a1.$id)]);
check('dos repartidores intentan aceptar a la vez: solo el asignado acepta', acc[0].s === 200 && acc[1].s === 403 && a1.driverResponse === 'accepted', acc.map((x) => x.s));
// aceptar mientras el personal reasigna: la aceptacion nunca queda sobre otro repartidor
for (let i = 0; i < 3; i++) {
  r9 = await mkOrder('u1', [{ menuId: 'm1', quantity: 1 }]); const rr = orderRow(r9);
  for (const s of ['confirmed', 'preparing']) await ops(mk('staff1', { orderId: rr.$id, status: s }));
  await ops(mk('staff1', { action: 'assignDriver', orderId: rr.$id, driverUserId: 'drv1' }));
  await Promise.all([accept('drv1', rr.$id), ops(mk('staff2', { action: 'assignDriver', orderId: rr.$id, driverUserId: 'drv2' }))]);
  check(`aceptar mientras se reasigna (#${i + 1}): la aceptación nunca cae sobre otro repartidor`, !(rr.driverUserId === 'drv2' && rr.driverResponse === 'accepted'), [rr.driverUserId, rr.driverResponse]);
}
// rechazar/aceptar un pedido terminado
r9 = await ops(mk('drv2', { action: 'respondAssignment', orderId: f2.$id, accept: false })); check('rechazar un pedido entregado -> 403/409 y el historial conserva al repartidor', r9.s >= 400 && f2.driverUserId === 'drv2', [r9, f2.driverUserId]);
r9 = await ops(mk('drv2', { action: 'respondAssignment', orderId: f1.$id, accept: true })); check('aceptar un pedido cancelado -> 409', r9.s === 409 && r9.b.code === 'not_assignable', r9);
r9 = await ops(mk('u1', { action: 'assignDriver', orderId: a1.$id, driverUserId: 'drv1' })); check('un cliente no asigna repartidores', r9.s === 403, r9);

// ---- admin: paginacion, limites y errores
store.menu.length = 0; store.menu.push({ $id: 'm1', name: 'Burger', price: 10 }, { $id: 'm2', name: 'Pizza', price: 12 });
for (let i = 0; i < 250; i++) store.menu.push({ $id: `bulk${i}`, name: `Producto ${i}`, price: 5, stock: 10 });
r9 = await admin(mk('staff1', { action: 'listProducts' })); check('listProducts pagina y devuelve los 252 productos', r9.s === 200 && r9.b.products.length === 252 && r9.b.truncated === false, [r9.s, r9.b.products?.length, r9.b.truncated]);
const base = store.orders.length;
for (let i = 0; i < 250; i++) store.orders.push({ $id: `rep${i}`, userId: 'ux', status: 'delivered', total: 10, paymentMethod: 'cash_on_delivery', paymentStatus: 'not_required', $createdAt: '2026-11-01T10:00:00.000Z' });
r9 = await admin(mk('staff1', { action: 'report', from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' })); check('el reporte recorre varias páginas: 250 entregados = 2500', r9.s === 200 && r9.b.report.delivered === 250 && r9.b.report.sales === 2500 && r9.b.truncated === false, [r9.s, r9.b.report?.delivered]);
r9 = await admin(mk('staff1', { action: 'saveProduct', product: { name: 'Hack', price: 1 } })); check('el personal no crea productos por parámetros manipulados -> 403', r9.s === 403, r9);
r9 = await admin(mk('staff1', { action: 'setRole', userId: 'staff1', labels: ['admin'] })); check('el personal no se concede el rol admin -> 403', r9.s === 403 && !store.labels.staff1.includes('admin'), r9);
r9 = await admin({ ...mk('staff1', { action: 'listProducts' }), req: { headers: { 'x-appwrite-user-id': 'staff1', 'x-appwrite-key': 'k' }, bodyText: '{no json' } }); check('JSON inválido -> 400 genérico', r9.s === 400 && !JSON.stringify(r9.b).includes('Unexpected'), r9);
const adminLeak = await admin({ ...mk('staff1', { action: 'adjustStock', productId: 'bulk1', delta: 1 }), error() {} }); check('los errores no exponen detalles internos', !JSON.stringify(adminLeak.b).match(/stack|at \w+\.|node_modules/), adminLeak.b);
}

// ---- plan gratuito (2 funciones): update-order-status atiende estado + webhook de Stripe + administración
{
const two = (await import('./plan-gratuito/update-order-status/src/main.js')).default;
const twoCreate = (await import('./plan-gratuito/create-order/src/main.js')).default;
store.prefs = {};
let q = await twoCreate(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] })));
check('2 funciones: create-order crea pedido en línea', q.s === 200 && !!q.b.checkoutUrl, q);
const po = store.orders.find((o) => o.$id === q.b.orderId);
if (po) {
  const ps = net.stripe.sessions[po.stripeSessionId]; payInStripe(ps.id, { amount: ps.amount_total });
  const e2 = completed(po, ps);
  q = await two(hk(e2)); check('2 funciones: el webhook de Stripe entra por update-order-status y marca pagado', q.s === 200 && po.paymentStatus === 'paid', [q.s, po.paymentStatus]);
  q = await two(hk(e2)); check('2 funciones: webhook duplicado sin efecto doble', q.s === 200 && po.paymentStatus === 'paid', q);
  q = await two(hk(e2, { 'stripe-signature': sign('{}', { secret: 'otro' }) })); check('2 funciones: firma falsa -> 400', q.s === 400, q);
}
q = await two(mk('staff1', { action: 'listProducts' })); check('2 funciones: admin listProducts por la misma función', q.s === 200 && Array.isArray(q.b.products), q);
q = await two(mk('u1', { action: 'listProducts' })); check('2 funciones: cliente no entra a admin -> 403', q.s === 403, q);
q = await two(mk('staff1', { action: 'setProductAvailability', productId: 'm2', available: false })); check('2 funciones: staff cambia disponibilidad de producto', q.s === 200 && q.b.product.available === false, q);
q = await two(mk('drv1', { action: 'setAvailability', available: false })); check('2 funciones: repartidor cambia SU disponibilidad (no la del producto)', q.s === 200 && store.prefs.drv1?.driverAvailable === false, q);
if (po) { q = await two(mk('staff1', { orderId: po.$id, status: 'confirmed' })); check('2 funciones: transición de estado sigue funcionando', q.s === 200 && po.status === 'confirmed', [q.s, q.b, po.status]); }
}

// ---- v10: contrato de pago, diagnóstico y mapa de personal
{
store.prefs = {};
let q = await createOrder(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] })));
check('v10: pedido en línea responde paymentMethod=online, pending y la versión', q.s === 200 && q.b.paymentMethod === 'online' && q.b.paymentStatus === 'pending' && q.b.backend === 'v10' && !!q.b.checkoutUrl, q);
const saved = store.orders.find((o) => o.$id === q.b.orderId);
check('v10: lo guardado coincide (online, pending, con sesión Stripe)', saved.paymentMethod === 'online' && saved.paymentStatus === 'pending' && !!saved.stripeSessionId, saved);
const body2 = other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] });
let a = await createOrder(mk('u1', body2)); let b = await createOrder(mk('u1', body2));
check('v10: el reintento devuelve el mismo pedido y su método real (online)', a.b.orderId === b.b.orderId && b.b.duplicate === true && b.b.paymentMethod === 'online', [a.b, b.b]);
q = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1 }] })));
check('v10: efectivo responde cash_on_delivery / not_required', q.s === 200 && q.b.paymentMethod === 'cash_on_delivery' && q.b.paymentStatus === 'not_required', q);
q = await createOrder(mk('u1', { action: 'diag' }));
check('v10: diag devuelve solo booleanos y la versión (sin valores)', q.s === 200 && q.b.backend === 'v10' && typeof q.b.stripeKey === 'boolean' && !JSON.stringify(q.b).match(/sk_|whsec_|key_/), q);
q = await createOrder(mk(null, { action: 'diag' }));
check('v10: diag sin sesión -> 401', q.s === 401, q);
const drvOrder = store.orders.find((o) => o.driverUserId && ['picked_up', 'on_the_way', 'ready', 'preparing', 'confirmed'].includes(o.status)) || null;
q = await ops(mk('staff1', { action: 'listOrders' }));
check('v10: listOrders (personal) incluye ubicación del repartidor solo si hay repartidor', q.s === 200 && q.b.orders.every((o) => (o.driverUserId ? true : o.driverLatitude === null)), q.b.orders && q.b.orders.length);
q = await ops(mk('u1', { action: 'listOrders' }));
check('v10: cliente sigue sin listar pedidos -> 403', q.s === 403, q);
}

// ---- v11: repartidores (estados, reclamo atomico), entrega, reembolsos y administracion
{
const admin = (await import('./admin-api/src/main.js')).default;
store.prefs = {}; store.status = {};
store.labels.drv3 = ['driver']; store.names.drv3 = 'Marta';
store.menu.push({ $id: 'v11inv', name: 'Stock11', price: 9, stock: 6, lowStockThreshold: 1 });
const newOrder = async (o = {}) => { const x = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1 }], ...o }))); return store.orders.find((q) => q.$id === x.b.orderId); };
const st = (id, status, extra = {}, who = 'staff1') => ops(mk(who, { orderId: id, status, ...extra }));
const free = () => store.orders.forEach((o) => { if (['drv1', 'drv2', 'drv3'].includes(o.driverUserId) && !['delivered', 'cancelled'].includes(o.status)) o.status = 'cancelled'; });
const toReady = async (id) => { for (const s of ['confirmed', 'preparing', 'ready']) { const x = await st(id, s); if (x.s !== 200) return x; } return { s: 200 }; };
let r;

// --- estados del repartidor: desconectado / disponible / ocupado
r = await ops(mk('staff1', { action: 'listDrivers' }));
check('v11: repartidor sin actividad = disponible', r.b.drivers.find((d) => d.id === 'drv1').status === 'available', r.b);
r = await ops(mk('drv1', { action: 'setAvailability', available: false }));
r = await ops(mk('staff1', { action: 'listDrivers' }));
let d1 = r.b.drivers.find((d) => d.id === 'drv1');
check('v11: al desconectarse pasa a offline y queda registrada su última señal', d1.status === 'offline' && d1.available === false && !!d1.lastSeenAt, d1);
const pool1 = await newOrder(); await toReady(pool1.$id);
r = await ops(mk('drv1', { action: 'availableOrders' }));
check('v11: un repartidor desconectado no recibe pedidos disponibles', r.s === 200 && r.b.offline === true && r.b.orders.length === 0, r);
r = await ops(mk('drv1', { action: 'claimOrder', orderId: pool1.$id }));
check('v11: desconectado no puede reclamar (409 driver_offline)', r.s === 409 && r.b.code === 'driver_offline' && !pool1.driverUserId, r);
await ops(mk('drv1', { action: 'setAvailability', available: true }));

// --- pedidos disponibles: privacidad y permisos
r = await ops(mk('drv1', { action: 'availableOrders' }));
const view = r.b.orders.find((o) => o.id === pool1.$id);
check('v11: pedidos disponibles se listan', r.s === 200 && !!view, r);
check('v11: la lista de disponibles NO expone nombre, teléfono ni dirección del cliente', view && !JSON.stringify(view).match(/FALSO|5512|Reforma|customer|contact|address/i) && view.itemsCount === 1, view);
r = await ops(mk('u1', { action: 'availableOrders' })); check('v11: cliente no ve pedidos disponibles (403)', r.s === 403, r);
r = await ops(mk('staff1', { action: 'availableOrders' })); check('v11: personal usa listOrders, no la bolsa del repartidor (403)', r.s === 403, r);
const pend = await newOrder();
r = await ops(mk('drv1', { action: 'availableOrders' })); check('v11: un pedido pendiente (sin confirmar) no aparece', !r.b.orders.some((o) => o.id === pend.$id), r.b);
r = await ops(mk('drv1', { action: 'claimOrder', orderId: pend.$id })); check('v11: no se reclama un pedido sin confirmar (409 not_available)', r.s === 409 && r.b.code === 'not_available', r);

// --- dos repartidores reclaman el mismo pedido a la vez (varias repeticiones)
free(); let oneWinner = true, evOk = true; const dbgRounds = [];
for (let i = 0; i < 5; i++) {
  const o = await newOrder(); await toReady(o.$id);
  const [a, b] = await Promise.all([ops(mk('drv1', { action: 'claimOrder', orderId: o.$id })), ops(mk('drv2', { action: 'claimOrder', orderId: o.$id }))]);
  const wins = [a, b].filter((x) => x.s === 200).length, losses = [a, b].filter((x) => x.s === 409 && x.b.code === 'already_taken').length;
  const winner = a.s === 200 ? 'drv1' : 'drv2';
  if (!(wins === 1 && losses === 1 && o.driverUserId === winner && o.driverResponse === 'accepted')) { oneWinner = false; dbgRounds.push([a.s, a.b.code, b.s, b.b.code, o.driverUserId]); }
  if (store.events.filter((e) => e.orderId === o.$id && e.type === 'driver_claimed').length !== 1) evOk = false;
  free();
}
check('v11: dos repartidores reclamando a la vez -> uno gana (200) y otro 409 already_taken (5 rondas)', oneWinner, dbgRounds);
check('v11: queda un solo evento driver_claimed por pedido (quién aceptó)', evOk);
{
  free();
  const o = await newOrder(); await toReady(o.$id);
  r = await ops(mk('drv1', { action: 'claimOrder', orderId: o.$id }));
  const again = await ops(mk('drv1', { action: 'claimOrder', orderId: o.$id }));
  check('v11: el mismo repartidor repitiendo el reclamo es idempotente', r.s === 200 && again.s === 200 && again.b.duplicate === true);
  const other2 = await ops(mk('drv2', { action: 'claimOrder', orderId: o.$id })); check('v11: otro repartidor después -> 409', other2.s === 409 && other2.b.code === 'already_taken', other2);
  r = await ops(mk('staff1', { action: 'assignDriver', orderId: o.$id, driverUserId: 'drv2' }));
  check('v11: el personal puede reasignar un pedido ya aceptado', r.s === 200 && o.driverUserId === 'drv2' && o.driverResponse === 'pending', [r, o.driverUserId]);
  r = await ops(mk('drv2', { action: 'respondAssignment', orderId: o.$id, accept: false, reason: 'Se me ponchó la llanta' }));
  check('v11: al rechazar, el pedido vuelve a la bolsa y queda el motivo', r.s === 200 && !o.driverUserId && store.events.some((e) => e.orderId === o.$id && e.type === 'driver_rejected' && /llanta/.test(e.note || '')), [r, o.driverUserId]);
  r = await ops(mk('drv3', { action: 'claimOrder', orderId: o.$id })); check('v11: otro repartidor lo toma tras el rechazo', r.s === 200 && o.driverUserId === 'drv3', r);
}
// tope de entregas activas
{
  const mine = []; for (let i = 0; i < 4; i++) { const o = await newOrder(); await toReady(o.$id); mine.push(o); }
  store.orders.filter((o) => o.driverUserId === 'drv3' && !['delivered', 'cancelled'].includes(o.status)).forEach((o) => { o.driverUserId = null; });
  const res4 = []; for (const o of mine) res4.push((await ops(mk('drv3', { action: 'claimOrder', orderId: o.$id }))).s);
  check('v11: el repartidor no pasa del máximo de entregas activas (3 sí, la 4.ª 409)', res4.join() === '200,200,200,409', res4);
  mine.forEach((o) => { o.driverUserId = null; });
}

// --- cancelar después de asignarse, con motivo
{
  const o = await newOrder({ items: [{ menuId: 'v11inv', quantity: 2 }] }); await st(o.$id, 'confirmed');
  const stockBefore = store.menu.find((m) => m.$id === 'v11inv').stock - 0 + 2; // ya descontado al crear
  r = await ops(mk('drv2', { action: 'claimOrder', orderId: o.$id }));
  store.pushes.length = 0;
  r = await st(o.$id, 'cancelled'); check('v11: el personal debe indicar motivo al cancelar (400)', r.s === 400 && r.b.code === 'reason_required' && o.status === 'confirmed', r);
  r = await st(o.$id, 'cancelled', { reason: 'x' }); check('v11: motivo demasiado corto (400)', r.s === 400, r);
  r = await st(o.$id, 'cancelled', { reason: 'Cliente no respondió al teléfono' });
  check('v11: cancelación con motivo -> 200 y se guarda en el historial', r.s === 200 && o.status === 'cancelled' && store.events.some((e) => e.orderId === o.$id && e.toStatus === 'cancelled' && /no respondió/.test(e.note || '')), r);
  check('v11: se avisa al repartidor asignado de la cancelación', store.pushes.some((p) => /cancelado/i.test(p.title || '') && JSON.stringify(p).includes('drv2')), store.pushes.map((p) => p.title));
  check('v11: el stock del pedido cancelado vuelve una sola vez', store.menu.find((m) => m.$id === 'v11inv').stock === stockBefore, [store.menu.find((m) => m.$id === 'v11inv').stock, stockBefore]);
  r = await st(o.$id, 'cancelled', { reason: 'otra vez' }); check('v11: cancelar de nuevo -> 409 y sin segunda devolución', r.s === 409 && store.moves.filter((m) => m.orderId === o.$id && m.type === 'release').length === 1, r);
  r = await ops(mk('drv3', { action: 'claimOrder', orderId: o.$id })); check('v11: no se reclama un pedido cancelado', r.s === 409, r);
  r = await ops(mk('u1', { orderId: o.$id, status: 'cancelled', reason: 'x' })); check('v11: el cliente tampoco cancela uno ya cancelado', r.s === 409 || r.s === 403, r);
}

// --- entrega: recogida implícita, protección y confirmación del cliente
{
  const o = await newOrder(); await toReady(o.$id);
  r = await st(o.$id, 'delivered'); check('v11: no se entrega un pedido que no fue recogido/en camino (409)', r.s === 409 && o.status === 'ready', r);
  await ops(mk('drv1', { action: 'claimOrder', orderId: o.$id }));
  r = await st(o.$id, 'delivered', {}, 'drv1'); check('v11: el repartidor tampoco puede entregar desde "listo" (409)', r.s === 409, r);
  r = await st(o.$id, 'on_the_way', {}, 'drv1'); check('v11: el repartidor sale a reparto', r.s === 200 && o.status === 'on_the_way', r);
  check('v11: queda constancia de la recogida (picked_up) con el repartidor como autor', store.events.some((e) => e.orderId === o.$id && e.toStatus === 'picked_up' && e.actorId === 'drv1'), store.events.filter((e) => e.orderId === o.$id).map((e) => e.toStatus));
  r = await ops(mk('u1', { action: 'confirmReceipt', orderId: o.$id })); check('v11: no se confirma recepción antes de la entrega (409)', r.s === 409 && r.b.code === 'not_delivered', r);
  r = await ops(mk('drv2', { orderId: o.$id, status: 'delivered' })); check('v11: repartidor ajeno no marca entregado (403)', r.s === 403 && o.status === 'on_the_way', r);
  r = await st(o.$id, 'delivered', {}, 'drv1'); check('v11: entrega confirmada por el repartidor', r.s === 200 && o.status === 'delivered', r);
  check('v11: se sabe quién entregó (evento con actor)', store.events.some((e) => e.orderId === o.$id && e.toStatus === 'delivered' && e.actorId === 'drv1' && e.driverUserId === 'drv1'));
  r = await ops(mk('u2', { action: 'confirmReceipt', orderId: o.$id })); check('v11: otro cliente no confirma recepción ajena (404)', r.s === 404 && !o.receivedAt, r);
  r = await ops(mk('staff1', { action: 'confirmReceipt', orderId: o.$id })); check('v11: el personal no confirma en nombre del cliente (404)', r.s === 404 && !o.receivedAt, r);
  r = await ops(mk('u1', { action: 'confirmReceipt', orderId: o.$id })); check('v11: el cliente confirma la recepción', r.s === 200 && !!o.receivedAt && store.events.some((e) => e.orderId === o.$id && e.type === 'received' && e.actorRole === 'customer'), r);
  const at = o.receivedAt; r = await ops(mk('u1', { action: 'confirmReceipt', orderId: o.$id })); check('v11: confirmar dos veces es idempotente', r.s === 200 && r.b.duplicate === true && o.receivedAt === at, r);
  store.pushes.length = 0;
  r = await ops(mk('u1', { action: 'reportIssue', orderId: o.$id, reason: 'Faltó una bebida' })); check('v11: el cliente reporta un problema (y se avisa al personal)', r.s === 200 && r.b.reported === true && store.events.some((e) => e.orderId === o.$id && e.type === 'customer_issue'), r);
  r = await ops(mk('u1', { action: 'reportIssue', orderId: o.$id, reason: 'Faltó una bebida' })); check('v11: el mismo problema no se registra dos veces', r.s === 200 && r.b.duplicate === true && store.events.filter((e) => e.orderId === o.$id && e.type === 'customer_issue').length === 1, r);
  r = await ops(mk('u2', { action: 'reportIssue', orderId: o.$id, reason: 'Faltó una bebida' })); check('v11: no se reporta un pedido ajeno (404)', r.s === 404, r);
  r = await ops(mk('u1', { action: 'reportIssue', orderId: o.$id, reason: '' })); check('v11: el reporte exige motivo (400)', r.s === 400, r);
  r = await ops(mk('u1', { action: 'reportIssue', orderId: pend.$id, reason: 'todavia no llega' })); check('v11: no se reporta un pedido que aún no sale (409)', r.s === 409, r);
}

// --- repartidor pierde conexión durante la entrega: el personal lo cierra con motivo y se puede reintentar
{
  const o = await newOrder(); await toReady(o.$id);
  await ops(mk('drv1', { action: 'claimOrder', orderId: o.$id })); await st(o.$id, 'on_the_way', {}, 'drv1');
  await ops(mk('drv1', { action: 'updateLocation', orderId: o.$id, latitude: 19.51, longitude: -99.21 }));
  r = await ops(mk('staff1', { action: 'driversMap' }));
  const pt = r.b.orders.find((x) => x.id === o.$id);
  check('v11: el mapa del personal muestra la última ubicación del repartidor y su hora', r.s === 200 && pt && pt.driverLatitude === 19.51 && !!pt.driverUpdatedAt, pt);
  check('v11: el mapa lista al repartidor en tránsito como ocupado', r.b.drivers.find((d) => d.id === 'drv1').status === 'busy', r.b.drivers);
  store.prefs.drv1 = { ...(store.prefs.drv1 || {}), driverLastSeenAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() };
  r = await ops(mk('staff1', { action: 'listDrivers' })); const d = r.b.drivers.find((x) => x.id === 'drv1');
  check('v11: sin señal reciente se marca connected=false (informativo)', d.connected === false, d);
  r = await st(o.$id, 'delivery_failed', { reason: 'El repartidor perdió conexión y el cliente no contesta' });
  check('v11: el personal reporta entrega no realizada con motivo', r.s === 200 && o.status === 'delivery_failed' && store.events.some((e) => e.orderId === o.$id && e.toStatus === 'delivery_failed' && /perdió conexión/.test(e.note || '')), r);
  r = await st(o.$id, 'on_the_way', {}, 'drv1'); check('v11: el repartidor puede reintentar la entrega', r.s === 200 && o.status === 'on_the_way', r);
  r = await ops(mk('drv2', { orderId: o.$id, status: 'delivered' })); check('v11: un repartidor ajeno sigue sin poder cerrar el pedido (403)', r.s === 403, r);
}
// asignación automática: ignora desconectados y sin señal vencida
{
  store.prefs = { drv1: { driverLastSeenAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }, drv2: { driverAvailable: false }, drv3: { driverLastSeenAt: new Date().toISOString() } };
  free();
  const o = await newOrder(); await st(o.$id, 'confirmed');
  process.env.AUTO_ASSIGN_DRIVER = 'true'; const opsAuto11 = (await import('./update-order-status/src/main.js?auto11')).default; process.env.AUTO_ASSIGN_DRIVER = 'false';
  r = await opsAuto11(mk('staff1', { orderId: o.$id, status: 'preparing' }));
  check('v11: la asignación automática elige solo al repartidor conectado y con señal reciente', r.s === 200 && o.driverUserId === 'drv3', [r.s, o.driverUserId]);
  store.prefs = {};
}

// --- reembolsos totales y parciales (solo administrador)
{
  const op = await newOrder({ paymentMethod: 'online' }); const sp = net.stripe.sessions[op.stripeSessionId]; payInStripe(sp.id, { amount: Math.round(op.total * 100) });
  r = await hook(hk(completed(op, sp))); check('v11: (preparación) pedido pagado por webhook', op.paymentStatus === 'paid', op.paymentStatus);
  const total = op.total;
  r = await ops(mk('staff1', { action: 'refundOrder', orderId: op.$id, amount: 1, reason: 'cortesía' })); check('v11: el personal no reembolsa (403)', r.s === 403, r);
  r = await ops(mk('u1', { action: 'refundOrder', orderId: op.$id, reason: 'quiero mi dinero' })); check('v11: el cliente no reembolsa (403)', r.s === 403, r);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, amount: 5 })); check('v11: reembolso sin motivo -> 400', r.s === 400 && r.b.code === 'reason_required', r);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, amount: -3, reason: 'ajuste' })); check('v11: importe negativo -> 400', r.s === 400, r);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, amount: total + 1, reason: 'ajuste' })); check('v11: importe mayor al cobrado -> 422', r.s === 422 && r.b.code === 'amount_exceeds', r);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, amount: '5', reason: 'ajuste' })); check('v11: importe que no es número -> 400', r.s === 400, r);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, amount: 5, reason: 'Producto frío' }));
  check('v11: reembolso parcial -> 200, sigue "paid" y acumula lo reembolsado', r.s === 200 && r.b.full === false && op.paymentStatus === 'paid' && op.refundedAmount === 5, [r, op.refundedAmount]);
  check('v11: Stripe recibió exactamente 500 centavos', Object.values(net.stripe.refunds).filter((x) => x.payment_intent === 'pi_' + sp.id).map((x) => x.amount).join() === '500', net.stripe.refunds);
  const nRef = Object.keys(net.stripe.refunds).length;
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, amount: total, reason: 'otra vez' })); check('v11: no se puede reembolsar más de lo que queda (422)', r.s === 422, r);
  check('v11: el rechazo no emitió reembolso en Stripe', Object.keys(net.stripe.refunds).length === nRef);
  // evento de Stripe del mismo reembolso parcial, dos veces: no cambia el estado ni duplica
  const part = { id: 'evt_p1', type: 'charge.refunded', data: { object: { amount: Math.round(total * 100), amount_refunded: 800, metadata: { orderId: op.$id } } } };
  r = await hook(hk(part)); await hook(hk(part));
  check('v11: webhook de reembolso parcial sincroniza el importe (8) y no cambia el pago', r.s === 200 && op.refundedAmount === 8 && op.paymentStatus === 'paid', [op.refundedAmount, op.paymentStatus]);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, reason: 'devolver el resto' }));
  check('v11: reembolsar el resto -> reembolso total y estado "refunded"', r.s === 200 && r.b.full === true && op.paymentStatus === 'refunded', r);
  const sum = Object.values(net.stripe.refunds).filter((x) => x.payment_intent === 'pi_' + sp.id).reduce((a, x) => a + x.amount, 0);
  check('v11: lo reembolsado en Stripe nunca supera lo cobrado', sum <= Math.round(total * 100) && sum > 0, [sum, total]);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: op.$id, reason: 'otra vez' })); check('v11: ya reembolsado -> 409', r.s === 409 && r.b.code === 'already_refunded', r);
  r = await ops(mk('adm1', { action: 'refundOrder', orderId: (await newOrder()).$id, reason: 'efectivo' })); check('v11: pedido en efectivo no se reembolsa por Stripe (409)', r.s === 409 && r.b.code === 'not_online', r);
  check('v11: el reembolso queda en el historial y en la auditoría', store.events.some((e) => e.orderId === op.$id && e.type === 'payment_refunded' && /parcial/.test(e.note || '')) && store.audit.some((a) => a.action === 'refund' && a.targetId === op.$id), store.audit);

  // cancelar un pedido con reembolso parcial previo: solo se devuelve lo que falta
  const oc = await newOrder({ paymentMethod: 'online' }); const sc = net.stripe.sessions[oc.stripeSessionId]; payInStripe(sc.id, { amount: Math.round(oc.total * 100) }); await hook(hk(completed(oc, sc)));
  await ops(mk('adm1', { action: 'refundOrder', orderId: oc.$id, amount: 4, reason: 'cortesía' }));
  r = await st(oc.$id, 'cancelled', { reason: 'Cliente cambió de opinión' });
  const sumC = Object.values(net.stripe.refunds).filter((x) => x.payment_intent === 'pi_' + sc.id).reduce((a, x) => a + x.amount, 0);
  check('v11: cancelar tras un reembolso parcial devuelve solo el resto (total = lo cobrado)', r.s === 200 && sumC === Math.round(oc.total * 100) && oc.paymentStatus === 'refunded' && oc.status === 'cancelled', [r, sumC, oc.total]);
  const nR2 = Object.keys(net.stripe.refunds).length; await st(oc.$id, 'cancelled', { reason: 'otra vez' });
  check('v11: cancelar de nuevo no reembolsa otra vez', Object.keys(net.stripe.refunds).length === nR2);
}

// --- administración: tablero, categorías, clientes, usuarios, auditoría
{
  const dOrd = await newOrder(); await toReady(dOrd.$id); await ops(mk('drv3', { action: 'claimOrder', orderId: dOrd.$id })); await st(dOrd.$id, 'on_the_way', {}, 'drv3'); await st(dOrd.$id, 'delivered', {}, 'drv3');
  r = await admin(mk('staff1', { action: 'dashboard' })); check('v11: el tablero financiero no es para el personal (403)', r.s === 403, r);
  r = await admin(mk('u1', { action: 'dashboard' })); check('v11: ni para clientes (403)', r.s === 403, r);
  r = await admin(mk('adm1', { action: 'dashboard' }));
  const db = r.b.dashboard;
  check('v11: tablero del administrador (ventas, pipeline, métodos de pago, repartidores)', r.s === 200 && db.sales > 0 && db.revenueByMethod.cash > 0 && typeof db.pipeline.delivered === 'number' && Array.isArray(db.salesByWeek) && Array.isArray(db.salesByMonth) && r.b.driversSummary.total === 3, r.b);
  const sumStatus = Object.values(db.byStatus).reduce((a, b) => a + b, 0);
  check('v11: el tablero cuadra con los pedidos reales (suma por estado = total de pedidos)', sumStatus === store.orders.length, [sumStatus, store.orders.length]);
  check('v11: rendimiento por repartidor incluye entregas de drv3', db.drivers.some((x) => x.driverUserId === 'drv3' && x.delivered >= 1), db.drivers);
  r = await admin(mk('adm1', { action: 'dashboard', from: 'no-es-fecha' })); check('v11: fechas inválidas -> 400', r.s === 400, r);

  r = await admin(mk('staff1', { action: 'saveCategory', category: { name: 'Postres' } })); check('v11: el personal no crea categorías (403)', r.s === 403, r);
  r = await admin(mk('adm1', { action: 'saveCategory', category: { name: 'x' } })); check('v11: nombre de categoría inválido -> 422', r.s === 422, r);
  r = await admin(mk('adm1', { action: 'saveCategory', category: { name: 'Postres', description: 'Dulces', isAdmin: true } })); const cat = r.b.category;
  check('v11: el administrador crea una categoría', r.s === 200 && cat && cat.name === 'Postres' && !('isAdmin' in store.cats.at(-1)), r);
  r = await admin(mk('adm1', { action: 'saveCategory', categoryId: cat.id, category: { name: 'Postres y más' } })); check('v11: edita una categoría', r.s === 200 && r.b.category.name === 'Postres y más', r);
  r = await admin(mk('adm1', { action: 'setCategoryActive', categoryId: cat.id, active: false }));
  r = await admin(mk('adm1', { action: 'listCategories' })); check('v11: desactivar una categoría se refleja en el listado', r.b.categories.find((c) => c.id === cat.id).active === false, r.b);
  r = await admin(mk('adm1', { action: 'setCategoryActive', categoryId: cat.id, active: 'si' })); check('v11: estado de categoría inválido -> 400', r.s === 400, r);
  r = await admin(mk('adm1', { action: 'saveProduct', product: { name: 'Pastel', price: 20, categories: cat.id } })); const pastel = r.b.product;
  r = await admin(mk('adm1', { action: 'deleteCategory', categoryId: cat.id }));
  check('v11: no se borra una categoría con productos (409)', r.s === 409 && r.b.code === 'category_in_use' && store.cats.some((c) => c.$id === cat.id), r);
  await admin(mk('adm1', { action: 'saveProduct', productId: pastel.id, product: { categories: 'cat1' } }));
  r = await admin(mk('staff1', { action: 'deleteCategory', categoryId: cat.id })); check('v11: el personal no borra categorías (403)', r.s === 403, r);
  r = await admin(mk('adm1', { action: 'deleteCategory', categoryId: cat.id })); check('v11: se borra una categoría vacía', r.s === 200 && !store.cats.some((c) => c.$id === cat.id), r);

  r = await admin(mk('staff1', { action: 'listCustomers' })); check('v11: el personal no consulta clientes (datos personales) (403)', r.s === 403, r);
  r = await admin(mk('drv1', { action: 'customerOrders', customerId: 'u1' })); check('v11: un repartidor tampoco (403)', r.s === 403, r);
  store.labels.u1 = []; store.labels.u2 = [];
  r = await admin(mk('adm1', { action: 'listCustomers' }));
  check('v11: lista de clientes sin personal ni repartidores', r.s === 200 && r.b.customers.some((c) => c.id === 'u1') && !r.b.customers.some((c) => ['staff1', 'drv1', 'adm1'].includes(c.id)), r.b);
  check('v11: la lista de clientes no incluye contraseñas, preferencias ni etiquetas', !JSON.stringify(r.b).match(/prefs|labels|password/i), r.b);
  const nAudit = store.audit.length;
  r = await admin(mk('adm1', { action: 'customerOrders', customerId: 'u1' }));
  check('v11: historial de pedidos de un cliente (sin direcciones por defecto)', r.s === 200 && r.b.orders.length > 0 && !('addresses' in r.b) && store.audit.length === nAudit, r.b);
  r = await admin(mk('adm1', { action: 'customerOrders', customerId: 'u1', includeAddresses: true }));
  check('v11: consultar direcciones queda auditado', r.s === 200 && Array.isArray(r.b.addresses) && store.audit.some((a) => a.action === 'customer_addresses_viewed' && a.targetId === 'u1'), [r.b, store.audit.at(-1)]);

  r = await admin(mk('staff1', { action: 'setUserStatus', userId: 'u2', active: false })); check('v11: el personal no desactiva cuentas (403)', r.s === 403, r);
  r = await admin(mk('adm1', { action: 'setUserStatus', userId: 'adm1', active: false })); check('v11: nadie se desactiva a sí mismo (409)', r.s === 409 && r.b.code === 'self_disable', r);
  r = await admin(mk('adm1', { action: 'setUserStatus', userId: 'u2', active: 'no' })); check('v11: estado inválido -> 400', r.s === 400, r);
  r = await admin(mk('adm1', { action: 'setUserStatus', userId: 'u2', active: false })); check('v11: el administrador desactiva una cuenta', r.s === 200 && store.status.u2 === false, r);
  r = await admin(mk('adm1', { action: 'setUserStatus', userId: 'u2', active: true })); check('v11: y la reactiva', r.s === 200 && store.status.u2 === true, r);
  r = await admin(mk('adm1', { action: 'setUserStatus', userId: 'adm2', active: false })); check('v11: puede desactivar a otro administrador si queda uno activo', r.s === 200, r);
  r = await admin(mk('adm1', { action: 'setUserStatus', userId: 'adm2', active: true }));
  for (const id of Object.keys(store.labels)) if (store.labels[id].includes('admin') && id !== 'adm1') store.status[id] = false; store.status.adm1 = true; // el resto de admins inactivos
  r = await admin(mk('adm2', { action: 'setUserStatus', userId: 'adm1', active: false })); check('v11: no se desactiva al último administrador activo (409)', r.s === 409 && r.b.code === 'last_admin', r);
  for (const id of Object.keys(store.labels)) if (store.labels[id].includes('admin')) store.status[id] = true;

  r = await admin(mk('staff1', { action: 'listAudit' })); check('v11: la auditoría es solo del administrador (403)', r.s === 403, r);
  r = await admin(mk('adm1', { action: 'listAudit' }));
  check('v11: la auditoría registra acciones críticas (reembolso, categorías, estado de usuarios)', r.s === 200 && r.b.enabled && ['refund', 'category_create', 'user_status'].every((a) => r.b.entries.some((e) => e.action === a)), r.b.entries.map((e) => e.action));
  check('v11: la auditoría no guarda datos personales (correos/teléfonos)', !JSON.stringify(r.b).match(/@ejemplo|5512/), r.b);

  r = await ops(mk('staff1', { action: 'driverHistory', driverUserId: 'drv3' }));
  check('v11: historial de entregas de un repartidor (con totales)', r.s === 200 && r.b.stats.delivered >= 1 && r.b.orders.every((o) => o.driverUserId === 'drv3'), r.b.stats);
  r = await ops(mk('drv1', { action: 'driverHistory', driverUserId: 'drv3' })); check('v11: un repartidor no consulta el historial de otro (403)', r.s === 403, r);
  r = await ops(mk('u1', { action: 'driversMap' })); check('v11: el mapa de repartidores no es para clientes (403)', r.s === 403, r);
  r = await ops(mk('drv1', { action: 'driversMap' })); check('v11: ni para repartidores (403)', r.s === 403, r);
  r = await admin(mk('adm1', { action: 'listPayments', paymentMethod: 'cash_on_delivery' })); check('v11: pagos en efectivo consultables por el administrador', r.s === 200 && r.b.payments.length > 0 && r.b.payments.every((p) => p.paymentMethod === 'cash_on_delivery'), r.b.payments?.length);
}

// --- el cliente sigue sin poder tocar precios, pagos, estados ni asignaciones
{
  const o = await newOrder();
  for (const patch of [{ paymentStatus: 'paid' }, { total: 0.01 }, { status: 'delivered' }, { driverUserId: 'u1' }, { receivedAt: '2026-01-01' }, { refundedAmount: 99 }]) {
    const c = await createOrder(mk('u1', other({ items: [{ menuId: 'm1', quantity: 1 }], ...patch })));
    const row = store.orders.find((x) => x.$id === c.b.orderId);
    if (!row || row.paymentStatus === 'paid' || row.total < 5 || row.status === 'delivered' || row.driverUserId || row.receivedAt || row.refundedAmount) check('v11: create-order ignora ' + Object.keys(patch)[0], false, row);
  }
  check('v11: create-order ignora campos de pago/estado/total/asignación enviados por el cliente', true);
  r = await ops(mk('u1', { action: 'refundOrder', orderId: o.$id, reason: 'x y z' })); check('v11: cliente no usa refundOrder (403)', r.s === 403);
  r = await ops(mk('u1', { action: 'claimOrder', orderId: o.$id })); check('v11: cliente no usa claimOrder (403)', r.s === 403);
  r = await ops(mk('drv1', { action: 'confirmReceipt', orderId: o.$id })); check('v11: repartidor no confirma recepción (404)', r.s === 404);
}
}

console.log(`\n${ok} ok, ${bad} fallas`); process.exit(bad ? 1 : 0);
