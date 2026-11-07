// Doble en memoria de node-appwrite para pruebas de humo. NO es Appwrite real.
export const store = { orders: [], items: [], menu: [], cust: [], rel: [], events: [], users: [], labels: {}, names: {}, failItemAt: 0, failEvents: false, pushes: [], failPush: false };
let tick = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString();
let n = 0;
export class Client { setEndpoint(){return this} setProject(){return this} setKey(){return this} }
export const ID = { unique: () => 'id' + String(++n).padStart(18, '0') };
export const Permission = { read: (r) => `read(${r})` };
export const Role = { user: (u) => `user:${u}` };
export const Query = {
  equal: (f, v) => ({ f, v: [].concat(v) }),
  limit: () => ({}),
  orderDesc: () => ({}),
  orderAsc: () => ({}),
  greaterThanEqual: (f, v) => ({ f, op: 'gte', v: [v] }),
  lessThanEqual: (f, v) => ({ f, op: 'lte', v: [v] })
};
const T = { orders: 'orders', items: 'items', menu: 'menu', cust: 'cust', rel: 'rel', events: 'events', users: 'users' };
const tbl = (id) => store[T[id]];
const matches = (r, queries) => queries.filter((q) => q.f).every((q) => {
  const val = r[q.f];
  const id = val && typeof val === 'object' ? val.$id : val;
  if (q.op === 'gte') return String(val) >= q.v[0];
  if (q.op === 'lte') return String(val) <= q.v[0];
  return q.v.includes(id);
});
export class TablesDB {
  async listRows({ tableId, queries = [] }) { return { rows: tbl(tableId).filter((r) => matches(r, queries)) }; }
  async createRow({ tableId, rowId, data, permissions }) {
    if (tableId === 'items' && store.failItemAt && store.items.length + 1 === store.failItemAt) throw new Error('boom');
    if (tableId === 'events' && store.failEvents) throw new Error('events down');
    const row = { $id: rowId, $createdAt: stamp(), $updatedAt: stamp(), ...data, permissions }; tbl(tableId).push(row); return row;
  }
  async getRow({ tableId, rowId }) { const r = tbl(tableId).find((x) => x.$id === rowId); if (!r) throw new Error('nf'); return r; }
  async updateRow({ tableId, rowId, data }) { const r = await this.getRow({ tableId, rowId }); Object.assign(r, data, { $updatedAt: stamp() }); return r; }
  async deleteRow({ tableId, rowId }) { const a = tbl(tableId); a.splice(a.findIndex((x) => x.$id === rowId), 1); return {}; }
}
export class Users {
  async get({ userId }) {
    if (!(userId in store.labels) && !(userId in store.names)) { if (!userId.startsWith('u')) throw new Error('user_not_found'); }
    return { $id: userId, labels: store.labels[userId] ?? [], name: store.names[userId] ?? userId };
  }
  async list({ queries = [] }) {
    const q = queries.find((x) => x.f === 'labels');
    const ids = Object.keys(store.labels).filter((id) => !q || store.labels[id].some((l) => q.v.includes(l)));
    return { users: ids.map((id) => ({ $id: id, name: store.names[id] ?? id })) };
  }
}
// Appwrite Messaging: solo registra los envios (no hay FCM real).
export class Messaging {
  async createPush(params) {
    if (store.failPush) throw new Error('messaging caido');
    store.pushes.push(params); return { $id: params.messageId };
  }
}
