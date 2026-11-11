#!/usr/bin/env node
/**
 * V12: asigna permisos POR FILA a datos antiguos (necesario al quitar permisos "any" de las tablas).
 *   node scripts/backfill-row-permissions.mjs          -> SIMULACION (no escribe nada)
 *   node scripts/backfill-row-permissions.mjs --apply  -> aplica
 * users: read/update/delete del dueno (accountId). orders: read del dueno (userId).
 * order_items: read del dueno del pedido. No borra ni cambia otros campos. Nunca imprime la API key.
 * Si una fila ya tiene permisos, se omite (idempotente). Haz un respaldo/exportacion antes de --apply.
 */
import { Client, TablesDB, Query } from 'node-appwrite';

const need = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error(`Faltan variables: ${missing.join(', ')}`); process.exit(2); }
const APPLY = process.argv.includes('--apply');
const DB = process.env.APPWRITE_DATABASE_ID ?? '6ab6f27e000135138f89';
const T = {
    users: process.env.APPWRITE_USERS_TABLE_ID ?? '6ab6f52f00317b447fbe',
    orders: process.env.APPWRITE_ORDERS_TABLE_ID ?? '6ab727bd00217e5c8f8d',
    items: process.env.APPWRITE_ORDER_ITEMS_TABLE_ID ?? '6ab7281f0039efe022c2'
};
const db = new TablesDB(new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));

async function* all(tableId) {
    let cursor;
    for (;;) {
        const q = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
        const page = await db.listRows({ databaseId: DB, tableId, queries: q });
        for (const r of page.rows) yield r;
        if (page.rows.length < 100) return;
        cursor = page.rows.at(-1).$id;
    }
}
const stats = { users: [0, 0, 0], orders: [0, 0, 0], items: [0, 0, 0] }; // [actualizadas, omitidas, fallos]
const orderOwner = new Map();
const apply = async (kind, tableId, row, owner, perms) => {
    if (!owner) { stats[kind][2]++; console.log(`SIN DUEÑO  ${kind} ${row.$id}`); return; }
    if ((row.$permissions ?? []).length) { stats[kind][1]++; return; }
    if (APPLY) {
        try { await db.updateRow({ databaseId: DB, tableId, rowId: row.$id, permissions: perms(owner) }); stats[kind][0]++; }
        catch (e) { stats[kind][2]++; console.log(`FALLO      ${kind} ${row.$id}: ${String(e?.message ?? e).slice(0, 100)}`); }
    } else stats[kind][0]++;
};
for await (const r of all(T.users)) await apply('users', T.users, r, r.accountId, (o) => [`read("user:${o}")`, `update("user:${o}")`, `delete("user:${o}")`]);
for await (const r of all(T.orders)) { orderOwner.set(r.$id, r.userId); await apply('orders', T.orders, r, r.userId, (o) => [`read("user:${o}")`]); }
for await (const r of all(T.items)) await apply('items', T.items, r, orderOwner.get(r.orderId), (o) => [`read("user:${o}")`]);
console.log(APPLY ? 'APLICADO' : 'SIMULACION (usa --apply para escribir)');
for (const [k, [u, o, f]] of Object.entries(stats)) console.log(`${k.padEnd(7)} ${APPLY ? 'actualizadas' : 'por actualizar'}=${u} ya-con-permisos=${o} sin-dueño/fallos=${f}`);
