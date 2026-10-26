// Autoprueba de la migracion con un doble en memoria (no toca Appwrite). Uso: node scripts/migrate-selftest.mjs (requiere node-appwrite instalado).
import { run, PLAN } from './appwrite-migrate.mjs';
const cols = {}, idx = {}, tables = new Set(); const calls = [];
const db = {
  listTables: async () => ({tables: [...tables].map(id=>({$id:id}))}),
  createTable: async (p) => { tables.add(p.tableId); calls.push('T+'+p.tableId+JSON.stringify(p.permissions)); },
  deleteTable: async (p) => { tables.delete(p.tableId); delete cols[p.tableId]; delete idx[p.tableId]; calls.push('T-'+p.tableId); },
  listColumns: async ({tableId}) => { if (PLAN[tableId]?.isNew && !tables.has(tableId)) throw new Error('no table'); return {columns: (cols[tableId] ??= []).map(k => ({key:k, status:'available'}))}; },
  listIndexes: async ({tableId}) => ({indexes: (idx[tableId] ??= []).map(k => ({key:k}))}),
  createStringColumn: async (p) => { (cols[p.tableId] ??= []).push(p.key); calls.push('s:'+p.key); },
  createFloatColumn: async (p) => { (cols[p.tableId] ??= []).push(p.key); calls.push('f:'+p.key); },
  createDatetimeColumn: async (p) => { (cols[p.tableId] ??= []).push(p.key); calls.push('d:'+p.key); },
  createBooleanColumn: async (p) => { (cols[p.tableId] ??= []).push(p.key); calls.push('b:'+p.key+'='+p.xdefault); },
  createIndex: async (p) => { (idx[p.tableId] ??= []).push(p.key); calls.push('i:'+p.key); },
  deleteColumn: async (p) => { cols[p.tableId] = cols[p.tableId].filter(k=>k!==p.key); calls.push('-c:'+p.key); },
  deleteIndex: async (p) => { idx[p.tableId] = idx[p.tableId].filter(k=>k!==p.key); calls.push('-i:'+p.key); },
};
const quiet = () => {};
await run(db, {apply:false, rollback:false, log:quiet});
console.log('vista previa -> escrituras:', calls.length);
await run(db, {apply:true, rollback:false, log:quiet});
console.log('aplicar -> operaciones:', calls.length, '| tabla historial creada sin permisos:', calls.some(c=>c==='T+order_events[]'), '| available default true:', calls.includes('b:available=true'));
const before = calls.length;
await run(db, {apply:true, rollback:false, log:quiet});
console.log('segunda aplicación (idempotente) -> nuevas:', calls.length-before);
await run(db, {apply:true, rollback:true, log:quiet});
console.log('rollback -> tabla historial existe:', tables.has('order_events'), '| columnas restantes:', Object.values(cols).flat().length, '| índices:', Object.values(idx).flat().length);
