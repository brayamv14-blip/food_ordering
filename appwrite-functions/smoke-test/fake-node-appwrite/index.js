// Doble en memoria de node-appwrite para pruebas de humo. NO es Appwrite real.
export const store = { orders: [], items: [], menu: [], cust: [], rel: [], events: [], users: [], moves: [], cats: [], prefs: {}, failIncrement: false, columnMin0: true, failDecrementFor: null, decrementCalls: 0, failDecrementNth: 0, labels: {}, names: {}, failItemAt: 0, failEvents: false, pushes: [], failPush: false };
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString();
let n = 0;
export class Client { setEndpoint(){return this} setProject(){return this} setKey(){return this} }
export const ID = { unique: () => 'id' + String(++n).padStart(18, '0') };
export const Permission = { read: (r) => `read(${r})` };
export const Role = { user: (u) => `user:${u}` };
export const Query = {
  equal: (f, v) => ({ f, v: [].concat(v) }),
  limit: (n) => ({ limit: n }),
  offset: (n) => ({ offset: n }),
  orderDesc: () => ({}),
  orderAsc: () => ({}),
  greaterThanEqual: (f, v) => ({ f, op: 'gte', v: [v] }),
  lessThanEqual: (f, v) => ({ f, op: 'lte', v: [v] })
};
const T = { orders: 'orders', items: 'items', menu: 'menu', cust: 'cust', rel: 'rel', events: 'events', users: 'users', moves: 'moves', cats: 'cats' };
const tbl = (id) => store[T[id]];
const matches = (r, queries) => queries.filter((q) => q.f).every((q) => {
  const val = r[q.f];
  const id = val && typeof val === 'object' ? val.$id : val;
  if (q.op === 'gte') return String(val) >= q.v[0];
  if (q.op === 'lte') return String(val) <= q.v[0];
  return q.v.includes(id);
});
export class TablesDB {
  async listRows({ tableId, queries = [] }) {
    const all = tbl(tableId).filter((r) => matches(r, queries));
    const off = queries.find((q) => q.offset !== undefined)?.offset ?? 0;
    const lim = queries.find((q) => q.limit !== undefined)?.limit ?? 25; // Appwrite devuelve 25 por omision
    return { rows: all.slice(off, off + lim) };
  }
  async createRow({ tableId, rowId, data, permissions }) {
    if (tableId === 'items' && store.failItemAt && store.items.length + 1 === store.failItemAt) throw new Error('boom');
    if (tableId === 'events' && store.failEvents) throw new Error('events down');
    // Indice unico de orders.clientRequestId (lo crea la migracion).
    if (tableId === 'orders' && data.clientRequestId && store.orders.some((o) => o.clientRequestId === data.clientRequestId)) { const e = new Error('Row with the requested unique index already exists'); e.code = 409; throw e; }
    if (tbl(tableId).some((x) => x.$id === rowId)) { const e = new Error('Document with the requested ID already exists'); e.code = 409; throw e; }
    const row = { $id: rowId, $createdAt: stamp(), $updatedAt: stamp(), ...data, permissions }; tbl(tableId).push(row); return row;
  }
  async getRow({ tableId, rowId }) { const r = tbl(tableId).find((x) => x.$id === rowId); if (!r) throw new Error('nf'); return r; }
  async updateRow({ tableId, rowId, data }) { const r = await this.getRow({ tableId, rowId }); Object.assign(r, data, { $updatedAt: stamp() }); return r; }
  // Operaciones atomicas del servidor: aqui son sincronas dentro de un mismo tick, como en Appwrite.
  // `min` se IGNORA a proposito: la documentacion de Appwrite no dice si un limite violado rechaza o recorta, y el
  // codigo de las Functions ya no depende de el. `columnMin0` emula una columna con minimo 0 (rechaza con 400);
  // en false emula una columna que admite negativos (el codigo debe detectar y compensar la sobreventa).
  async decrementRowColumn({ tableId, rowId, column, value }) {
    store.decrementCalls++;
    if (store.failDecrementNth && store.decrementCalls === store.failDecrementNth) throw new Error('db caida');
    if (store.failDecrementFor && rowId === store.failDecrementFor) throw new Error('db caida');
    const r = await this.getRow({ tableId, rowId });
    const next = (r[column] ?? 0) - value;
    if (store.columnMin0 && next < 0) { const e = new Error('Invalid document structure: column below minimum'); e.code = 400; throw e; }
    r[column] = next; return { ...r };
  }
  async incrementRowColumn({ tableId, rowId, column, value }) {
    if (store.failIncrement) throw new Error('increment down');
    const r = await this.getRow({ tableId, rowId }); r[column] = (r[column] ?? 0) + value; return { ...r };
  }
  async deleteRow({ tableId, rowId }) { const a = tbl(tableId); a.splice(a.findIndex((x) => x.$id === rowId), 1); return {}; }
}
export class Users {
  async get({ userId }) {
    if (!(userId in store.labels) && !(userId in store.names)) { if (!userId.startsWith('u')) throw new Error('user_not_found'); }
    return { $id: userId, labels: store.labels[userId] ?? [], name: store.names[userId] ?? userId, prefs: store.prefs[userId] ?? {}, email: userId + '@ejemplo.test' };
  }
  async list({ queries = [], search } = {}) {
    const q = queries.find((x) => x.f === 'labels');
    const ids = Object.keys(store.labels).filter((id) => (!q || store.labels[id].some((l) => q.v.includes(l))) && (!search || (store.names[id] ?? id).toLowerCase().includes(search.toLowerCase())));
    return { users: ids.map((id) => ({ $id: id, name: store.names[id] ?? id, labels: store.labels[id], prefs: store.prefs[id] ?? {}, email: id + '@ejemplo.test' })) };
  }
  async updatePrefs({ userId, prefs }) { store.prefs[userId] = prefs; return prefs; }
  async updateLabels({ userId, labels }) { store.labels[userId] = labels; return { $id: userId, labels }; }
}
// Appwrite Messaging: solo registra los envios (no hay FCM real).
export class Messaging {
  async createPush(params) {
    if (store.failPush) throw new Error('messaging caido');
    store.pushes.push(params); return { $id: params.messageId };
  }
}
