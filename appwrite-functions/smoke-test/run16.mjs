// V16: alta/aprobacion de repartidores, finanzas, OTP de entrega, ganancias, tiempo limite. SIMULACION en memoria (no es Appwrite real).
import { store } from 'node-appwrite';
for (const [k, v] of Object.entries({ DATABASE_ID: 'db', ORDERS_TABLE_ID: 'orders', ORDER_ITEMS_TABLE_ID: 'items', MENU_TABLE_ID: 'menu', INVENTORY_MOVES_TABLE_ID: 'moves', CATEGORIES_TABLE_ID: 'cats', AUDIT_TABLE_ID: 'audit', AUTO_ASSIGN_DRIVER: 'false', ORDER_EVENTS_TABLE_ID: 'events', STORES_TABLE_ID: 'stores', DRIVERS_ENABLED: 'true',
  DELIVERY_OTP: 'true', DELIVERY_OTP_SECRET: 'secreto-de-prueba-no-real', ASSIGNMENT_TIMEOUT_SECONDS: '120', PLATFORM_COMMISSION_PCT: '10', DRIVER_FEE_PCT: '80' })) process.env[k] = v;
const ops = (await import('./update-order-status/src/main.js')).default;
const admin = (await import('./admin-api/src/main.js')).default;
const rules = await import('./update-order-status/src/rules.js');
const mk = (user, body) => ({ req: { headers: user ? { 'x-appwrite-user-id': user, 'x-appwrite-key': 'k' } : {}, bodyJson: body }, res: { json: (b, s = 200) => ({ s, b }) }, log(){}, error(){} });
let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : bad++; console.log((cond ? 'OK   ' : 'FALLA'), name, cond ? '' : JSON.stringify(extra)); };
const adm = (u, b) => admin(mk(u, b)); const op = (u, b) => ops(mk(u, b));

// ---- Reglas puras (centavos)
let f = rules.splitFinance({ subtotal: 100, deliveryFee: 20, discount: 10, tip: 5, total: 115, driverUserId: 'd' }, { platformPct: 10, driverPct: 80 });
check('finanzas: neto 90, comisión 9, tienda 81, repartidor 20*0.8+5=21', f.platformCommission === 9 && f.storeRevenue === 81 && f.driverEarning === 21 && f.total === 115, f);
check('finanzas: cobrado = tienda + comisión + envío + propina (sin envío del repartidor perdido)', Math.abs((f.storeRevenue + f.platformCommission + f.deliveryFee + f.tip) - f.total) < 0.01, f);
f = rules.splitFinance({ subtotal: 100, deliveryFee: 20, discount: 0, tip: 0, total: 120, refundedAmount: 120, driverUserId: 'd' }, { platformPct: 10, driverPct: 100 });
check('finanzas: reembolso total => todo en 0', f.platformCommission === 0 && f.storeRevenue === 0 && f.driverEarning === 0, f);
f = rules.splitFinance({ subtotal: 100, deliveryFee: 0, total: 100, refundedAmount: 50 }, { platformPct: 10 });
check('finanzas: reembolso parcial 50% escala comisión y tienda', f.platformCommission === 5 && f.storeRevenue === 45, f);
f = rules.splitFinance({ subtotal: 10, deliveryFee: 5, total: 15, driverUserId: 'd' }, { platformPct: 500, driverPct: -4 });
check('finanzas: porcentajes fuera de rango se acotan (0–100)', f.platformCommission === 10 && f.driverEarning === 0, f);
f = rules.splitFinance({ subtotal: 33.33, deliveryFee: 11.11, total: 44.44, driverUserId: 'd' }, { platformPct: 7.5, driverPct: 66.6 });
check('finanzas: redondeo en centavos sin decimales raros', [f.platformCommission, f.storeRevenue, f.driverEarning].every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9), f);
check('cuenta repartidor: estados pending/approved/suspended/null', rules.driverAccountState(['pdriver']) === 'pending' && rules.driverAccountState(['driver']) === 'approved' && rules.driverAccountState(['driver'], false) === 'suspended' && rules.driverAccountState([]) === null);
check('solicitud: teléfono y vehículo se validan', !rules.validateDriverApplication({ phone: '123', vehicle: 'moto' }).ok && !rules.validateDriverApplication({ phone: '5512345678', vehicle: 'nave' }).ok && rules.validateDriverApplication({ phone: '55 1234 5678', vehicle: 'moto' }).ok);
check('asignación vencida: solo pendiente y pasado el límite', rules.assignmentExpired({ driverUserId: 'd', driverResponse: 'pending', $updatedAt: '2026-01-01T00:00:00Z' }, 120, Date.parse('2026-01-01T00:03:00Z')) === true && rules.assignmentExpired({ driverUserId: 'd', driverResponse: 'pending', $updatedAt: '2026-01-01T00:00:00Z' }, 120, Date.parse('2026-01-01T00:01:00Z')) === false && rules.assignmentExpired({ driverUserId: 'd', driverResponse: 'accepted', $updatedAt: '2026-01-01T00:00:00Z' }, 120, Date.parse('2027-01-01')) === false && rules.assignmentExpired({ driverUserId: 'd', driverResponse: 'pending', $updatedAt: '2026-01-01T00:00:00Z' }, 0) === false);

// ---- Datos
store.stores.push({ $id: 'main', name: 'Matriz', active: true }, { $id: 'sA', name: 'A', active: true }, { $id: 'sB', name: 'B', active: true, platformPct: 20 }, { $id: 'sOff', name: 'Off', active: false });
store.labels = { sup: ['superadmin'], adminA: ['admin', 'stsA'], adminB: ['admin', 'stsB'], drvA: ['driver', 'stsA'], drvA2: ['driver', 'stsA'], drvB: ['driver', 'stsB'], cust1: [], cust2: [], cust3: [], staffA: ['staff', 'stsA'] };
store.names = { sup: 'Super', adminA: 'Admin A', adminB: 'Admin B', drvA: 'Rep A', drvA2: 'Rep A2', drvB: 'Rep B', cust1: 'Cliente 1', cust2: 'Cliente 2', cust3: 'Cliente 3', staffA: 'Staff A' };

// ---- Alta de repartidores
let r = await op('cust1', { action: 'applyDriver', application: { phone: '123', vehicle: 'moto', storeId: 'sA' } }); check('alta: teléfono inválido -> 400', r.s === 400 && r.b.code === 'bad_phone', r);
r = await op('cust1', { action: 'applyDriver', application: { phone: '55 1234 5678', vehicle: 'moto', storeId: 'sOff' } }); check('alta: tienda inactiva -> 422', r.s === 422, r);
r = await op(null, { action: 'applyDriver', application: {} }); check('alta: sin sesión -> 401', r.s === 401, r);
r = await op('cust1', { action: 'applyDriver', application: { phone: '55 1234 5678', vehicle: 'moto', storeId: 'sA', note: 'Tengo moto propia' } });
check('alta: el cliente queda PENDIENTE (etiqueta pdriver, nunca driver) y en la tienda elegida', r.s === 200 && r.b.state === 'pending' && store.labels.cust1.includes('pdriver') && !store.labels.cust1.includes('driver') && store.labels.cust1.includes('stsA'), [r, store.labels.cust1]);
r = await op('cust1', { action: 'applyDriver', application: { phone: '55 1234 5678', vehicle: 'moto', storeId: 'sA' } }); check('alta: no se duplica la solicitud -> 409', r.s === 409, r);
r = await op('cust1', { action: 'myDriverStatus' }); check('alta: el solicitante ve estado "pending"', r.s === 200 && r.b.state === 'pending', r);
r = await op('cust1', { action: 'myDeliveries' }); check('alta: un pendiente NO opera como repartidor (myDeliveries -> 403)', r.s === 403, r);
r = await op('cust1', { action: 'setAvailability', available: true }); check('alta: un pendiente no puede conectarse -> 403', r.s === 403, r);
r = await op('drvA', { action: 'applyDriver', application: { phone: '55 1234 5678', vehicle: 'moto' } }); check('alta: quien ya es repartidor no se re-aplica -> 409', r.s === 409, r);
r = await adm('cust1', { action: 'reviewDriver', userId: 'cust1', approve: true }); check('alta: un cliente no se aprueba a sí mismo -> 403', r.s === 403 && !store.labels.cust1.includes('driver'), r);
r = await adm('adminB', { action: 'listDriverApplications' }); check('alta: admin B no ve solicitudes de la tienda A', r.s === 200 && r.b.applications.length === 0, r);
r = await adm('adminB', { action: 'reviewDriver', userId: 'cust1', approve: true }); check('alta: admin B no aprueba solicitudes de A -> 404', r.s === 404 && !store.labels.cust1.includes('driver'), r);
r = await adm('staffA', { action: 'listDriverApplications' }); check('alta: el personal (no admin) no revisa solicitudes -> 403', r.s === 403, r);
r = await adm('adminA', { action: 'listDriverApplications' }); check('alta: admin A ve la solicitud con teléfono y vehículo', r.s === 200 && r.b.applications.length === 1 && r.b.applications[0].vehicle === 'moto' && r.b.applications[0].state === 'pending', r);
r = await adm('adminA', { action: 'reviewDriver', userId: 'cust1', approve: true });
check('alta: admin A aprueba -> etiqueta driver + tienda A, sin pdriver', r.s === 200 && r.b.state === 'approved' && store.labels.cust1.includes('driver') && !store.labels.cust1.includes('pdriver') && store.labels.cust1.includes('stsA'), [r, store.labels.cust1]);
r = await op('cust1', { action: 'setAvailability', available: true }); check('alta: ya aprobado, el repartidor puede conectarse', r.s === 200, r);
r = await op('cust2', { action: 'applyDriver', application: { phone: '55 8888 7777', vehicle: 'bicicleta', storeId: 'sB' } });
r = await adm('sup', { action: 'reviewDriver', userId: 'cust2', approve: false }); check('alta: rechazo quita pdriver y la etiqueta de tienda; no queda como repartidor', r.s === 200 && !store.labels.cust2.includes('pdriver') && !store.labels.cust2.includes('driver') && !store.labels.cust2.includes('stsB'), [r, store.labels.cust2]);
r = await adm('sup', { action: 'reviewDriver', userId: 'cust2', approve: true }); check('alta: revisar de nuevo algo que no es solicitud -> 404', r.s === 404, r);
check('alta: queda registro de auditoría de aplicar/aprobar/rechazar', ['driver_applied', 'driver_approved', 'driver_rejected'].every((a) => store.audit.some((x) => x.action === a)), store.audit.map((x) => x.action));
r = await adm('sup', { action: 'setUserStatus', userId: 'cust1', active: false }); r = await op('cust1', { action: 'myDriverStatus' }); check('suspender: la cuenta suspendida se ve como "suspended"', r.b.state === 'suspended', r);
await adm('sup', { action: 'setUserStatus', userId: 'cust1', active: true });

// ---- Pedidos para OTP / ganancias / tiempo límite
let seq = 0;
const mkOrder = (o) => { const row = { $id: `o16_${++seq}`.padEnd(8, 'x'), userId: 'cust3', storeId: 'sA', status: 'on_the_way', paymentMethod: 'cash_on_delivery', paymentStatus: 'not_required', subtotal: 100, deliveryFee: 20, discount: 0, tip: 5, total: 125, driverUserId: 'drvA', driverName: 'Rep A', driverResponse: 'accepted', $createdAt: new Date().toISOString(), $updatedAt: new Date().toISOString(), ...o }; store.orders.push(row); return row; };
let o1 = mkOrder({});
r = await op('cust3', { action: 'myDeliveryCode', orderId: o1.$id }); const code = r.b.code;
check('OTP: el dueño ve su código de 4 dígitos con el pedido en camino', r.s === 200 && /^\d{4}$/.test(code), r);
r = await op('cust1', { action: 'myDeliveryCode', orderId: o1.$id }); check('OTP: otro usuario NO ve el código (404)', r.s === 404, r);
r = await op('drvA', { action: 'myDeliveryCode', orderId: o1.$id }); check('OTP: el repartidor tampoco lo consulta (solo el cliente se lo da)', r.s === 404, r);
const o0 = mkOrder({ status: 'preparing' }); r = await op('cust3', { action: 'myDeliveryCode', orderId: o0.$id }); check('OTP: antes de salir el pedido no hay código', r.s === 200 && r.b.code === null, r);
r = await op('drvA', { orderId: o1.$id, status: 'delivered' }); check('OTP: entregar sin código -> 422 y el pedido NO cambia', r.s === 422 && r.b.code === 'bad_delivery_code' && o1.status === 'on_the_way', r);
r = await op('drvA', { orderId: o1.$id, status: 'delivered', deliveryCode: code === '0000' ? '1111' : '0000' }); check('OTP: código incorrecto -> 422', r.s === 422 && o1.status === 'on_the_way', r);
check('OTP: los intentos fallidos quedan en el historial', store.events.filter((e) => e.orderId === o1.$id && e.type === 'otp_failed').length === 2, store.events.map((e) => e.type));
r = await op('drvB', { orderId: o1.$id, status: 'delivered', deliveryCode: code }); check('OTP: otro repartidor (otra tienda) no entrega ese pedido', r.s === 404 || r.s === 403, r);
r = await op('drvA', { orderId: o1.$id, status: 'delivered', deliveryCode: code }); check('OTP: con el código correcto se entrega', r.s === 200 && o1.status === 'delivered', r);
const o2 = mkOrder({}); const wrong = (c) => (c === '1234' ? '4321' : '1234'); let last;
const c2 = (await op('cust3', { action: 'myDeliveryCode', orderId: o2.$id })).b.code;
for (let i = 0; i < 5; i++) last = await op('drvA', { orderId: o2.$id, status: 'delivered', deliveryCode: wrong(c2) });
r = await op('drvA', { orderId: o2.$id, status: 'delivered', deliveryCode: c2 }); check('OTP: tras 5 fallos se bloquea (429) incluso con el código correcto', r.s === 429 && r.b.code === 'otp_locked' && o2.status === 'on_the_way', r);
r = await op('staffA', { orderId: o2.$id, status: 'delivered' }); check('OTP: el personal puede cerrar la entrega bloqueada (soporte)', r.s === 200 && o2.status === 'delivered', r);
const o3 = mkOrder({}); const c3a = (await op('cust3', { action: 'myDeliveryCode', orderId: o3.$id })).b.code, c3b = (await op('cust3', { action: 'myDeliveryCode', orderId: o3.$id })).b.code;
check('OTP: el código es estable para un pedido y distinto entre pedidos', c3a === c3b && /^\d{4}$/.test(c3a) && c3a !== c2 && c3a !== code, [c3a, c3b, c2, code]);

// ---- Ganancias
r = await op('drvA', { action: 'driverEarnings' });
check('ganancias: el repartidor ve sus entregas (2) y ganancia = (20*0.8+5)*2 = 42', r.s === 200 && r.b.totals.delivered === 2 && r.b.totals.earnings === 42 && r.b.totals.tips === 10 && r.b.payouts === 'not_implemented', r.b);
r = await op('drvB', { action: 'driverEarnings' }); check('ganancias: otro repartidor no ve esas entregas', r.s === 200 && r.b.totals.delivered === 0, r.b);
r = await op('cust3', { action: 'driverEarnings' }); check('ganancias: un cliente no consulta ganancias -> 403', r.s === 403, r);
r = await op('adminB', { action: 'driverEarnings', driverUserId: 'drvA' }); check('ganancias: admin B no ve ganancias de un repartidor de A', r.s === 200 && r.b.totals.delivered === 0, r.b);
r = await op('adminA', { action: 'driverEarnings', driverUserId: 'drvA' }); check('ganancias: admin A consulta las de su repartidor', r.s === 200 && r.b.totals.delivered === 2, r.b);

// ---- Reporte financiero
const oB = mkOrder({ storeId: 'sB', status: 'delivered', driverUserId: 'drvB', driverName: 'Rep B', userId: 'cust2' });
r = await adm('sup', { action: 'financeReport' });
check('finanzas: superadmin ve totales (3 entregados) y por tienda', r.s === 200 && r.b.finance.totals.orders === 3 && r.b.finance.byStore.sA.orders === 2 && r.b.finance.byStore.sB.orders === 1, r.b);
check('finanzas: tienda A usa 10% global; tienda B su 20% propio', r.b.finance.byStore.sA.platformCommission === 20 && r.b.finance.byStore.sB.platformCommission === 20, r.b.finance.byStore);
check('finanzas: ganancias por repartidor y declara que NO hay transferencias automáticas', r.b.finance.byDriver.drvA.driverEarning === 42 && r.b.transfers === 'not_implemented', r.b);
r = await adm('adminA', { action: 'financeReport' }); check('finanzas: admin A solo ve su tienda', r.s === 200 && r.b.finance.totals.orders === 2 && !r.b.finance.byStore.sB, r.b);
r = await adm('staffA', { action: 'financeReport' }); check('finanzas: el personal no accede -> 403', r.s === 403, r);
r = await adm('cust1', { action: 'financeReport' }); check('finanzas: un repartidor/cliente no accede -> 403', r.s === 403, r);

// ---- Tiempo límite de respuesta
const oT = mkOrder({ status: 'preparing', driverUserId: 'drvA', driverName: 'Rep A', driverResponse: 'pending', $updatedAt: '2026-01-01T00:00:00.000Z' });
const oFresh = mkOrder({ status: 'preparing', driverUserId: 'drvA2', driverName: 'Rep A2', driverResponse: 'pending' });
const oAcc = mkOrder({ status: 'preparing', driverUserId: 'drvA', driverResponse: 'accepted', $updatedAt: '2026-01-01T00:00:00.000Z' });
const oOther = mkOrder({ storeId: 'sB', status: 'preparing', driverUserId: 'drvB', driverResponse: 'pending', $updatedAt: '2026-01-01T00:00:00.000Z' });
r = await op('cust3', { action: 'expireAssignments' }); check('límite: un cliente no lo ejecuta -> 403', r.s === 403, r);
r = await op('staffA', { action: 'expireAssignments' });
check('límite: libera SOLO la asignación vencida y pendiente de su tienda', r.s === 200 && r.b.expired.length === 1 && oT.driverUserId === null && oFresh.driverUserId === 'drvA2' && oAcc.driverUserId === 'drvA' && oOther.driverUserId === 'drvB', [r, oT.driverUserId]);
r = await op('staffA', { action: 'expireAssignments' }); check('límite: repetir no vuelve a expirar (idempotente)', r.s === 200 && r.b.expired.length === 0, r);
check('límite: queda evento driver_timeout y aviso al repartidor', store.events.some((e) => e.orderId === oT.$id && e.type === 'driver_timeout') && store.pushes.some((p) => JSON.stringify(p).includes('Solicitud vencida')), store.events.map((e) => e.type));

// ---- Comisión por tienda (solo superadmin)
r = await adm('adminB', { action: 'saveStore', storeId: 'sB', store: { platformPct: 50 } }); check('comisión: un admin de tienda NO fija su comisión -> 403', r.s === 403 && store.stores.find((x) => x.$id === 'sB').platformPct === 20, r);
r = await adm('sup', { action: 'saveStore', storeId: 'sB', store: { platformPct: 150 } }); check('comisión: fuera de 0–100 -> 422', r.s === 422, r);
r = await adm('sup', { action: 'saveStore', storeId: 'sB', store: { platformPct: 25, driverPct: 70 } }); check('comisión: el superadmin la fija sin otros cambios', r.s === 200 && store.stores.find((x) => x.$id === 'sB').platformPct === 25 && r.b.store.driverPct === 70, r);
r = await adm('sup', { action: 'financeReport' }); check('comisión: el reporte usa la nueva comisión de B (25% de 100 = 25)', r.b.finance.byStore.sB.platformCommission === 25, r.b.finance.byStore.sB);

// ---- Plan gratuito (2 funciones): las acciones nuevas pasan por el paquete
const two = (await import('./plan-gratuito/update-order-status/src/main.js')).default;
r = await two(mk('sup', { action: 'financeReport' })); check('plan gratuito: financeReport enruta a admin', r.s === 200 && r.b.finance, r);
r = await two(mk('adminA', { action: 'listDriverApplications' })); check('plan gratuito: listDriverApplications enruta a admin', r.s === 200 && Array.isArray(r.b.applications), r);
r = await two(mk('drvA', { action: 'driverEarnings' })); check('plan gratuito: driverEarnings enruta a estado', r.s === 200 && r.b.totals, r);

console.log(`\nV16: ${ok} ok, ${bad} fallas`); process.exit(bad ? 1 : 0);
