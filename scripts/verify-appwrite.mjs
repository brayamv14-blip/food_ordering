#!/usr/bin/env node
/**
 * Auditoría de SOLO LECTURA del Appwrite real (no crea, cambia ni borra nada).
 *
 *   node scripts/verify-appwrite.mjs
 *
 * Variables (las mismas de la migración): APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY y,
 * opcionales, APPWRITE_DATABASE_ID / APPWRITE_ORDERS_TABLE_ID / APPWRITE_USERS_TABLE_ID.
 * Nunca imprime la API key ni los valores de las variables de las Functions (solo sus nombres).
 *
 * Comprueba: qué Functions están desplegadas (y si tienen despliegue listo), qué variables tienen
 * configuradas, si `orders` tiene las columnas/índices esperados y qué permisos tiene la tabla.
 * Lo que no pueda leer (por scopes de la API key) se informa como "no verificado", no como correcto.
 */
import { Client, Functions, TablesDB } from 'node-appwrite';

const need = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
    console.error(`Faltan variables: ${missing.join(', ')}`);
    process.exit(2);
}
const DB = process.env.APPWRITE_DATABASE_ID ?? '6ab6f27e000135138f89';
const ORDERS = process.env.APPWRITE_ORDERS_TABLE_ID ?? '6ab727bd00217e5c8f8d';
const USERS = process.env.APPWRITE_USERS_TABLE_ID ?? '6ab6f52f00317b447fbe';
const MENU = process.env.APPWRITE_MENU_TABLE_ID ?? '6ab6f3150012494438c2';
const MOVES = process.env.APPWRITE_INVENTORY_MOVES_TABLE_ID ?? 'inventory_movements';

const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const fns = new Functions(client);
const db = new TablesDB(client);

const EXPECTED_FUNCTIONS = {
    'create-order': ['DATABASE_ID', 'ORDERS_TABLE_ID', 'ORDER_ITEMS_TABLE_ID', 'MENU_TABLE_ID', 'CUSTOMIZATIONS_TABLE_ID', 'STRIPE_SECRET_KEY', 'PAYMENT_RETURN_URL'],
    'update-order-status': ['DATABASE_ID', 'ORDERS_TABLE_ID', 'ORDER_ITEMS_TABLE_ID', 'STRIPE_SECRET_KEY', 'PAYMENT_RETURN_URL'],
    'stripe-webhook': ['DATABASE_ID', 'ORDERS_TABLE_ID', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
};
// v8: funcion de administracion (opcional hasta que se despliegue) y variables de inventario.
const OPTIONAL_FUNCTIONS = { 'admin-api': ['DATABASE_ID', 'ORDERS_TABLE_ID', 'ORDER_ITEMS_TABLE_ID', 'MENU_TABLE_ID', 'INVENTORY_MOVES_TABLE_ID'] };
const INVENTORY_VARS = ['INVENTORY_MOVES_TABLE_ID', 'MENU_TABLE_ID'];
const OLD_FUNCTIONS = ['staff-api', 'update-driver-location'];
const EXPECTED_COLUMNS = ['userId', 'status', 'total', 'paymentMethod', 'paymentStatus', 'paymentId', 'stripeSessionId', 'driverUserId', 'driverLatitude', 'driverLongitude', 'driverUpdatedAt', 'clientRequestId', 'deliveryLatitude', 'deliveryLongitude', 'driverResponse', 'stockReserved'];
const EXPECTED_INDEXES = ['uniq_clientRequestId', 'idx_userId', 'idx_driverUserId', 'idx_status'];

let problems = 0;
const invConfigured = {}; // funcion -> tiene INVENTORY_MOVES_TABLE_ID (debe ser igual en todas)
const line = (tag, msg) => console.log(`${tag.padEnd(12)} ${msg}`);
const safe = async (label, f) => {
    try { return await f(); } catch (e) { line('NO VERIFICADO', `${label}: ${e?.code ?? ''} ${String(e?.message ?? e).slice(0, 120)}`); return null; }
};

console.log('== Functions ==');
const list = await safe('listar funciones', () => fns.list());
if (list) {
    const byName = new Map(list.functions.map((f) => [f.name, f]));
    line('INFO', `Funciones en el proyecto: ${list.functions.length} (el plan gratuito permite 5).`);
    for (const [name, vars] of Object.entries({ ...EXPECTED_FUNCTIONS, ...OPTIONAL_FUNCTIONS })) {
        const f = byName.get(name);
        if (!f && name in OPTIONAL_FUNCTIONS) { line('INFO', `${name} no está desplegada (opcional: sin ella no hay panel de productos, usuarios ni reportes)`); continue; }
        if (!f) { line('FALTA', `${name} no está desplegada`); problems++; continue; }
        const ready = f.latestDeploymentStatus === 'ready';
        line(ready && f.enabled ? 'OK' : 'REVISAR', `${name}: enabled=${f.enabled} despliegue=${f.latestDeploymentStatus ?? 'ninguno'} execute=[${(f.execute ?? []).join(',')}] id=${f.$id}`);
        if (!ready || !f.enabled) problems++;
        if (name === 'stripe-webhook' && !(f.execute ?? []).includes('any')) { line('REVISAR', 'stripe-webhook debe tener Execute access = Any (la firma de Stripe autentica)'); problems++; }
        if (name !== 'stripe-webhook' && (f.execute ?? []).includes('any')) { line('REVISAR', `${name} no debería ser ejecutable por "any"`); problems++; }
        const vs = await safe(`variables de ${name}`, () => fns.listVariables({ functionId: f.$id }));
        if (vs) {
            const have = new Set(vs.variables.map((v) => v.key));
            invConfigured[name] = have.has('INVENTORY_MOVES_TABLE_ID');
            const miss = vars.filter((k) => !have.has(k));
            line(miss.length ? 'FALTAN VARS' : 'OK', miss.length ? `${name}: ${miss.join(', ')}` : `${name}: variables requeridas presentes`);
            if (miss.length) problems++;
            if (name === 'create-order' || name === 'update-order-status' || name === 'stripe-webhook') {
                const missInv = INVENTORY_VARS.filter((k) => !have.has(k));
                if (missInv.length) line('INFO', `${name}: sin ${missInv.join(', ')} el control de inventario queda DESACTIVADO`);
            }
            if (vs.variables.some((v) => /^EXPO_PUBLIC_/.test(v.key))) { line('REVISAR', `${name} tiene variables EXPO_PUBLIC_*: no deben usarse en el servidor`); problems++; }
        }
    }
    // Configuracion a medias = fuga de existencias: si create-order reserva pero otra funcion no puede devolver, el stock se pierde.
    const states = Object.entries(invConfigured);
    if (states.some(([, v]) => v) && states.some(([, v]) => !v)) {
        line('CRITICO', `INVENTORY_MOVES_TABLE_ID inconsistente: con=[${states.filter(([, v]) => v).map(([k]) => k)}] sin=[${states.filter(([, v]) => !v).map(([k]) => k)}]. Debe estar en TODAS o en NINGUNA.`);
        problems++;
    }
    for (const old of OLD_FUNCTIONS) if (byName.has(old)) line('INFO', `${old} sigue desplegada y la app actual ya no la invoca; puedes borrarla tú (esta herramienta no borra nada).`);
}

console.log('\n== Tabla orders ==');
const cols = await safe('columnas', () => db.listColumns({ databaseId: DB, tableId: ORDERS }));
if (cols) {
    const keys = new Set(cols.columns.map((c) => c.key));
    const miss = EXPECTED_COLUMNS.filter((k) => !keys.has(k));
    line(miss.length ? 'FALTAN' : 'OK', miss.length ? `columnas: ${miss.join(', ')} (ejecuta scripts/appwrite-migrate.mjs)` : 'todas las columnas esperadas existen');
    if (miss.length) problems++;
    const st = cols.columns.find((c) => c.key === 'status');
    if (st && st.type !== 'varchar' && st.type !== 'string') { line('REVISAR', `orders.status es "${st.type}": debe aceptar ready y delivery_failed`); problems++; }
}
const idx = await safe('índices', () => db.listIndexes({ databaseId: DB, tableId: ORDERS }));
if (idx) {
    const keys = new Set(idx.indexes.map((i) => i.key));
    const miss = EXPECTED_INDEXES.filter((k) => !keys.has(k));
    line(miss.length ? 'FALTAN' : 'OK', miss.length ? `índices: ${miss.join(', ')}` : 'índices esperados presentes');
    if (miss.length) problems++;
}
console.log('\n== Inventario (v8) ==');
// Las Functions usan decrementRowColumn/incrementRowColumn: se comprueba que el SDK instalado los tenga.
line(typeof db.decrementRowColumn === 'function' && typeof db.incrementRowColumn === 'function' ? 'OK' : 'REVISAR',
    typeof db.decrementRowColumn === 'function' ? 'node-appwrite local expone decrementRowColumn/incrementRowColumn (verifica la versión del runtime de la Function)' : 'node-appwrite local NO expone decrementRowColumn: actualiza la dependencia (~22.1.1) antes de desplegar');
if (typeof db.decrementRowColumn !== 'function') problems++;
const mcols = await safe('columnas de menu', () => db.listColumns({ databaseId: DB, tableId: MENU }));
if (mcols) {
    const keys = new Set(mcols.columns.map((c) => c.key));
    const miss = ['stock', 'lowStockThreshold', 'available'].filter((k) => !keys.has(k));
    line(miss.length ? 'FALTAN' : 'OK', miss.length ? `menu: ${miss.join(', ')} (ejecuta scripts/appwrite-migrate.mjs)` : 'menu tiene stock, lowStockThreshold y available');
    if (miss.length) problems++;
}
const mv = await safe('tabla de movimientos', () => db.listColumns({ databaseId: DB, tableId: MOVES }));
if (mv) {
    const miss = ['orderId', 'menuId', 'type', 'quantity', 'delta'].filter((k) => !mv.columns.some((c) => c.key === k));
    line(miss.length ? 'FALTAN' : 'OK', miss.length ? `${MOVES}: ${miss.join(', ')}` : `${MOVES} existe con las columnas esperadas`);
    if (miss.length) problems++;
    const t = await safe('permisos de movimientos', () => db.getTable({ databaseId: DB, tableId: MOVES }));
    if (t && (t.$permissions ?? []).length) { line('REVISAR', `${MOVES} no debería tener permisos de cliente (solo las Functions la usan)`); problems++; }
}

// El stock solo debe cambiarlo el servidor: si `menu` deja escribir a usuarios/any, un cliente podria ponerse stock o precio.
const menuTable = await safe('permisos de menu', () => db.getTable({ databaseId: DB, tableId: MENU }));
if (menuTable) {
    const perms = menuTable.$permissions ?? [];
    const writable = perms.filter((p) => /^(create|update|delete|write)\(/.test(p) && /users|any|guests/.test(p));
    line(writable.length ? 'CRITICO' : 'OK', writable.length ? `menu permite escribir a clientes: ${writable.join(' ')} (quítalo: stock y precios deben cambiarse solo por admin-api)` : 'menu: sin escritura para clientes a nivel de tabla');
    if (writable.length) problems++;
    if (menuTable.rowSecurity) line('INFO', 'menu tiene seguridad por fila activada: revisa que ninguna fila conceda escritura a clientes (esta herramienta no lee permisos por fila).');
}

console.log('\n== Permisos ==');
for (const [label, id] of [['orders', ORDERS], ['users', USERS]]) {
    const t = await safe(`permisos de ${label}`, () => db.getTable({ databaseId: DB, tableId: id }));
    if (t) {
        const perms = t.$permissions ?? [];
        const open = perms.filter((p) => /^(create|update|delete)\(/.test(p) && /users\)|any\)/.test(p));
        const readOpen = perms.filter((p) => /^read\(/.test(p) && /users|any|guests/.test(p));
        if (readOpen.length && label === 'orders') { line('CRITICO', `orders permite LEER a nivel de tabla a ${readOpen.join(' ')}: cualquier usuario vería pedidos ajenos (usa seguridad por fila; cada pedido ya lleva read(user:<dueño>))`); problems++; }
        line(open.length && label === 'orders' ? 'REVISAR' : 'INFO', `${label}: rowSecurity=${t.rowSecurity} permisos de tabla=[${perms.join(' ')}]`);
        if (open.length && label === 'orders') { line('NOTA', 'orders permite escribir a usuarios/any a nivel de tabla: tras probar el flujo, quítalo (ver docs/APPWRITE.md).'); problems++; }
    }
}

console.log(`\n${problems === 0 ? 'Sin hallazgos.' : `${problems} hallazgo(s) por revisar.`} (Solo lectura: no se modificó nada.)`);
process.exit(problems ? 1 : 0);
