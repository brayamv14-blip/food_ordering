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

const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
const fns = new Functions(client);
const db = new TablesDB(client);

const EXPECTED_FUNCTIONS = {
    'create-order': ['DATABASE_ID', 'ORDERS_TABLE_ID', 'ORDER_ITEMS_TABLE_ID', 'MENU_TABLE_ID', 'CUSTOMIZATIONS_TABLE_ID', 'STRIPE_SECRET_KEY', 'PAYMENT_RETURN_URL'],
    'update-order-status': ['DATABASE_ID', 'ORDERS_TABLE_ID', 'ORDER_ITEMS_TABLE_ID', 'STRIPE_SECRET_KEY', 'PAYMENT_RETURN_URL'],
    'stripe-webhook': ['DATABASE_ID', 'ORDERS_TABLE_ID', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
};
const OLD_FUNCTIONS = ['staff-api', 'update-driver-location'];
const EXPECTED_COLUMNS = ['userId', 'status', 'total', 'paymentMethod', 'paymentStatus', 'paymentId', 'stripeSessionId', 'driverUserId', 'driverLatitude', 'driverLongitude', 'driverUpdatedAt', 'clientRequestId', 'deliveryLatitude', 'deliveryLongitude'];
const EXPECTED_INDEXES = ['uniq_clientRequestId', 'idx_userId', 'idx_driverUserId', 'idx_status'];

let problems = 0;
const line = (tag, msg) => console.log(`${tag.padEnd(12)} ${msg}`);
const safe = async (label, f) => {
    try { return await f(); } catch (e) { line('NO VERIFICADO', `${label}: ${e?.code ?? ''} ${String(e?.message ?? e).slice(0, 120)}`); return null; }
};

console.log('== Functions ==');
const list = await safe('listar funciones', () => fns.list());
if (list) {
    const byName = new Map(list.functions.map((f) => [f.name, f]));
    line('INFO', `Funciones en el proyecto: ${list.functions.length} (el plan gratuito permite 5).`);
    for (const [name, vars] of Object.entries(EXPECTED_FUNCTIONS)) {
        const f = byName.get(name);
        if (!f) { line('FALTA', `${name} no está desplegada`); problems++; continue; }
        const ready = f.latestDeploymentStatus === 'ready';
        line(ready && f.enabled ? 'OK' : 'REVISAR', `${name}: enabled=${f.enabled} despliegue=${f.latestDeploymentStatus ?? 'ninguno'} execute=[${(f.execute ?? []).join(',')}] id=${f.$id}`);
        if (!ready || !f.enabled) problems++;
        if (name === 'stripe-webhook' && !(f.execute ?? []).includes('any')) { line('REVISAR', 'stripe-webhook debe tener Execute access = Any (la firma de Stripe autentica)'); problems++; }
        if (name !== 'stripe-webhook' && (f.execute ?? []).includes('any')) { line('REVISAR', `${name} no debería ser ejecutable por "any"`); problems++; }
        const vs = await safe(`variables de ${name}`, () => fns.listVariables({ functionId: f.$id }));
        if (vs) {
            const have = new Set(vs.variables.map((v) => v.key));
            const miss = vars.filter((k) => !have.has(k));
            line(miss.length ? 'FALTAN VARS' : 'OK', miss.length ? `${name}: ${miss.join(', ')}` : `${name}: variables requeridas presentes`);
            if (miss.length) problems++;
            if (vs.variables.some((v) => /^EXPO_PUBLIC_/.test(v.key))) { line('REVISAR', `${name} tiene variables EXPO_PUBLIC_*: no deben usarse en el servidor`); problems++; }
        }
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
for (const [label, id] of [['orders', ORDERS], ['users', USERS]]) {
    const t = await safe(`permisos de ${label}`, () => db.getTable({ databaseId: DB, tableId: id }));
    if (t) {
        const perms = t.$permissions ?? [];
        const open = perms.filter((p) => /^(create|update|delete)\(/.test(p) && /users\)|any\)/.test(p));
        line(open.length && label === 'orders' ? 'REVISAR' : 'INFO', `${label}: rowSecurity=${t.rowSecurity} permisos de tabla=[${perms.join(' ')}]`);
        if (open.length && label === 'orders') { line('NOTA', 'orders permite escribir a usuarios/any a nivel de tabla: tras probar el flujo, quítalo (ver docs/APPWRITE.md).'); problems++; }
    }
}

console.log(`\n${problems === 0 ? 'Sin hallazgos.' : `${problems} hallazgo(s) por revisar.`} (Solo lectura: no se modificó nada.)`);
process.exit(problems ? 1 : 0);
