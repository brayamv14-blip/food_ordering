
let sequence = 0;
let timestamp = Date.now();

const nextId = () => `mock_${String(++sequence).padStart(8, '0')}`;
const nextDate = () => new Date(++timestamp).toISOString();

const normalize = (value) => value && typeof value === 'object'
  ? (value.$id ?? JSON.stringify(value))
  : value;

export const store = {
  menu: [],
  cust: [],
  rel: [],
  orders: [],
  events: [],
  items: [],
  pushes: [],
  labels: {},
  names: {},
  failEvents: false,
  failItemAt: 0,
  failPush: false,
};

const tableFor = (id) => {
  const mapping = [
    [process.env.ORDERS_TABLE_ID, 'orders'],
    [process.env.ORDER_ITEMS_TABLE_ID, 'items'],
    [process.env.MENU_TABLE_ID, 'menu'],
    [process.env.CUSTOMIZATIONS_TABLE_ID, 'cust'],
    [process.env.MENU_CUSTOMIZATIONS_TABLE_ID, 'rel'],
    [process.env.ORDER_EVENTS_TABLE_ID, 'events'],
  ];

  const found = mapping.find(([tableId]) => tableId === id);

  if (!found) {
    throw new Error(`Tabla simulada desconocida: ${id}`);
  }

  return store[found[1]];
};

const matches = (row, query) => {
  const actual = row[query.attribute];
  const expected = query.values;

  if (query.method === 'equal') {
    const values = Array.isArray(expected) ? expected : [expected];

    if (Array.isArray(actual)) {
      return actual.some((a) =>
        values.some((v) => normalize(a) === normalize(v))
      );
    }

    return values.some((v) => normalize(actual) === normalize(v));
  }

  if (query.method === 'greaterThanEqual') {
    return String(actual ?? '') >= String(expected);
  }

  if (query.method === 'lessThanEqual') {
    return String(actual ?? '') <= String(expected);
  }

  return true;
};

class Client {
  setEndpoint() {
    return this;
  }

  setProject() {
    return this;
  }

  setKey() {
    return this;
  }
}

class TablesDB {
  constructor() {}

  async listRows({ tableId, queries = [] }) {
    let rows = [...tableFor(tableId)];

    for (const query of queries) {
      if (query.method === 'orderDesc' || query.method === 'orderAsc') {
        const direction = query.method === 'orderDesc' ? -1 : 1;

        rows.sort((a, b) =>
          direction * String(a[query.attribute] ?? '')
            .localeCompare(String(b[query.attribute] ?? ''))
        );
      } else if (query.method === 'limit') {
        rows = rows.slice(0, query.values);
      } else {
        rows = rows.filter((row) => matches(row, query));
      }
    }

    return {
      rows,
      total: rows.length,
    };
  }

  async getRow({ tableId, rowId }) {
    const row = tableFor(tableId).find((item) => item.$id === rowId);

    if (!row) {
      throw new Error(`Documento no encontrado: ${rowId}`);
    }

    return row;
  }

  async createRow({ tableId, rowId, data, permissions }) {
    const rows = tableFor(tableId);

    if (
      tableId === process.env.ORDER_EVENTS_TABLE_ID &&
      store.failEvents
    ) {
      throw new Error('Fallo simulado al guardar evento');
    }

    if (
      tableId === process.env.ORDER_ITEMS_TABLE_ID &&
      store.failItemAt > 0 &&
      rows.length + 1 >= store.failItemAt
    ) {
      throw new Error('Fallo simulado al guardar artículo');
    }

    const now = nextDate();

    const row = {
      $id: rowId || nextId(),
      $createdAt: now,
      $updatedAt: now,
      ...data,
    };

    if (permissions) {
      row.permissions = permissions;
    }

    rows.push(row);

    return row;
  }

  async updateRow({ tableId, rowId, data }) {
    const row = await this.getRow({ tableId, rowId });

    Object.assign(row, data, {
      $updatedAt: nextDate(),
    });

    return row;
  }

  async deleteRow({ tableId, rowId }) {
    const rows = tableFor(tableId);
    const index = rows.findIndex((item) => item.$id === rowId);

    if (index >= 0) {
      rows.splice(index, 1);
    }

    return {};
  }
}

class Users {
  async get({ userId }) {
    // El simulador permite consultar usuarios de prueba aunque no
    // estén registrados previamente en labels o names.
    return {
      $id: userId,
      name: store.names[userId] ?? '',
      labels: store.labels[userId] ?? [],
    };
  }

  async list({ queries = [] } = {}) {
    let users = Object.keys(store.labels).map((id) => ({
      $id: id,
      name: store.names[id] ?? '',
      labels: store.labels[id] ?? [],
    }));

    for (const query of queries) {
      if (query.method === 'equal') {
        const values = Array.isArray(query.values)
          ? query.values
          : [query.values];

        users = users.filter((user) =>
          values.some((value) =>
            user[query.attribute]?.includes(value)
          )
        );
      } else if (query.method === 'limit') {
        users = users.slice(0, query.values);
      }
    }

    return {
      users,
      total: users.length,
    };
  }
}

class Messaging {
  async createPush(message) {
    if (store.failPush) {
      throw new Error('Fallo simulado de Messaging');
    }

    store.pushes.push(message);

    return {
      $id: message.messageId,
    };
  }
}

const makeQuery = (method) => (attribute, values) => ({
  method,
  attribute,
  values,
});

export const appwriteTestAdapter = {
  Client,
  TablesDB,
  Users,
  Messaging,

  ID: {
    unique: nextId,
  },

  Permission: {
    read: (role) => `read(${role})`,
  },

  Role: {
    user: (id) => `user:${id}`,
  },

  Query: {
    equal: makeQuery('equal'),
    orderDesc: makeQuery('orderDesc'),
    orderAsc: makeQuery('orderAsc'),

    limit: (value) => ({
      method: 'limit',
      values: value,
    }),

    greaterThanEqual: makeQuery('greaterThanEqual'),
    lessThanEqual: makeQuery('lessThanEqual'),
  },
};
