import { store } from 'node-appwrite';
import { createHmac } from 'node:crypto';
for (const [k, v] of Object.entries({ DATABASE_ID: 'db', ORDERS_TABLE_ID: 'orders', ORDER_ITEMS_TABLE_ID: 'items', MENU_TABLE_ID: 'menu', CUSTOMIZATIONS_TABLE_ID: 'cust', MENU_CUSTOMIZATIONS_TABLE_ID: 'rel', ORDER_EVENTS_TABLE_ID: 'events', STRIPE_SECRET_KEY: 'sk_test_no_real_0000', STRIPE_WEBHOOK_SECRET: 'whsec_test_no_real', PAYMENT_RETURN_URL: 'https://equipo.github.io/delivery/pago.html' })) process.env[k] = v;

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
    const refund = { id: 're_' + (++S.seq), status: 'succeeded', payment_intent: form.get('payment_intent') };
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
r = await ops(mk('staff1', { orderId: o5.$id, status: 'cancelled' })); const refundsAfterFirst = Object.keys(net.stripe.refunds).length;
check('el personal cancela un pedido pagado: se reembolsa y se cancela', r.s === 200 && o5.status === 'cancelled' && o5.paymentStatus === 'refunded' && refundsAfterFirst === 1, [r, o5.paymentStatus]);
check('reembolso con clave de idempotencia ligada al pedido', net.calls.filter((c) => c.url.endsWith('/v1/refunds')).every((c) => c.opts.headers['Idempotency-Key'] === `refund-${o5.$id}`));
check('el cliente recibe cancelación y reembolso (sin duplicados)', pushes().map((p) => p.title).join('|') === 'Pedido cancelado|Reembolso emitido', pushes().map((p) => p.title));
r = await ops(mk('staff1', { orderId: o5.$id, status: 'cancelled' })); check('cancelar otra vez no reembolsa de nuevo', Object.keys(net.stripe.refunds).length === 1 && r.s >= 400, r);
r = await hook(hk({ id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', amount: 1450, amount_refunded: 1450, refunded: true, metadata: { orderId: o5.$id } } } })); check('webhook charge.refunded sobre pedido ya reembolsado es idempotente', r.s === 200 && o5.paymentStatus === 'refunded' && pushes().length === 2, pushes().map((p) => p.title));
{ // si el reembolso falla, el pedido NO se cancela
  r = await createOrder(mk('u1', other({ paymentMethod: 'online', items: [{ menuId: 'm1', quantity: 1 }] }))); const o7 = store.orders.find((o) => o.$id === r.b.orderId); const s7 = net.stripe.sessions[o7.stripeSessionId];
  payInStripe(s7.id, { amount: 1450 }); await hook(hk(completed(o7, s7)));
  net.stripe.refundOk = false;
  r = await ops(mk('staff1', { orderId: o7.$id, status: 'cancelled' })); check('si Stripe rechaza el reembolso, el pedido NO se cancela (502)', r.s === 502 && r.b.code === 'refund_failed' && o7.status === 'pending' && o7.paymentStatus === 'paid', r);
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
r = await ops(mk('staff1', { action: 'assignDriver', orderId: o9.$id, driverUserId: 'drv2' }));
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

console.log(`\n${ok} ok, ${bad} fallas`); process.exit(bad ? 1 : 0);
