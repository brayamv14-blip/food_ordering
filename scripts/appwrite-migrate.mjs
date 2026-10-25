#!/usr/bin/env node
/**
 * Migración de esquema de Appwrite para los Sprints 2 y 3 (idempotente).
 *
 *   Vista previa (no cambia nada):  node scripts/appwrite-migrate.mjs
 *   Aplicar:                        node scripts/appwrite-migrate.mjs --apply
 *   Revertir lo que agrega:         node scripts/appwrite-migrate.mjs --rollback --apply
 *
 * Requisitos: Node 18+, `npm i --no-save node-appwrite@22.1.1` y variables de entorno
 *   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY (clave de SERVIDOR con
 *   permisos de bases de datos). Esa clave NUNCA debe ir en la app ni en el repositorio.
 *
 * AVISO: escrito contra las firmas de node-appwrite 22.1.1 y la lógica verificada con
 * dobles de prueba, pero NO se ejecutó contra un proyecto real de Appwrite Cloud.
 */
import { Client, IndexType, OrderBy, TablesDB } from 'node-appwrite';

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID ?? '6ab6f27e000135138f89';
const ORDERS = process.env.APPWRITE_ORDERS_TABLE_ID ?? '6ab727bd00217e5c8f8d';
const USERS = process.env.APPWRITE_USERS_TABLE_ID ?? '6ab6f52f00317b447fbe';

const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');

const str = (key, size) => ({ kind: 'string', key, size });
const flt = (key, min, max) => ({ kind: 'float', key, min, max });
const dt = (key) => ({ kind: 'datetime', key });

export const PLAN = {
    [ORDERS]: {
        label: 'orders',
        columns: [
            flt('subtotal', 0, 1e7),
            str('clientRequestId', 64),
            str('customerName', 80),
            str('customerPhone', 20),
            str('deliveryAddress', 200),
            str('deliveryAddressLabel', 10),
            flt('deliveryLatitude', -90, 90),
            flt('deliveryLongitude', -180, 180),
            str('driverUserId', 64),
            str('driverName', 80),
            flt('driverLatitude', -90, 90),
            flt('driverLongitude', -180, 180),
            dt('driverUpdatedAt')
        ],
        indexes: [
            { key: 'uniq_clientRequestId', type: IndexType.Unique, columns: ['clientRequestId'] },
            { key: 'idx_userId', type: IndexType.Key, columns: ['userId'] },
            { key: 'idx_driverUserId', type: IndexType.Key, columns: ['driverUserId'] }
        ]
    },
    [USERS]: {
        label: 'users',
        columns: [
            str('selectedAddress', 10),
            flt('homeLatitude', -90, 90),
            flt('homeLongitude', -180, 180),
            flt('workLatitude', -90, 90),
            flt('workLongitude', -180, 180)
        ],
        indexes: []
    }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(db, { apply, rollback, log = console.log }) {
    for (const [tableId, plan] of Object.entries(PLAN)) {
        const existingCols = new Set((await db.listColumns({ databaseId: DATABASE_ID, tableId })).columns.map((c) => c.key));
        const existingIdx = new Set((await db.listIndexes({ databaseId: DATABASE_ID, tableId })).indexes.map((i) => i.key));

        if (rollback) {
            for (const i of [...plan.indexes].reverse()) {
                if (!existingIdx.has(i.key)) continue;
                log(`${apply ? 'ELIMINA' : '[vista previa] eliminaría'} índice ${plan.label}.${i.key}`);
                if (apply) await db.deleteIndex({ databaseId: DATABASE_ID, tableId, key: i.key });
            }
            if (apply) await sleep(1500);
            for (const c of plan.columns) {
                if (!existingCols.has(c.key)) continue;
                log(`${apply ? 'ELIMINA' : '[vista previa] eliminaría'} columna ${plan.label}.${c.key}  (SE PIERDEN SUS DATOS)`);
                if (apply) await db.deleteColumn({ databaseId: DATABASE_ID, tableId, key: c.key });
            }
            continue;
        }

        for (const c of plan.columns) {
            if (existingCols.has(c.key)) { log(`= ya existe ${plan.label}.${c.key}`); continue; }
            log(`${apply ? '+ crea' : '[vista previa] crearía'} columna ${plan.label}.${c.key} (${c.kind})`);
            if (!apply) continue;
            const base = { databaseId: DATABASE_ID, tableId, key: c.key, required: false };
            if (c.kind === 'string') await db.createStringColumn({ ...base, size: c.size });
            if (c.kind === 'float') await db.createFloatColumn({ ...base, min: c.min, max: c.max });
            if (c.kind === 'datetime') await db.createDatetimeColumn(base);
        }

        if (apply && plan.indexes.length) {
            // Las columnas se crean de forma asíncrona: esperar a que estén disponibles.
            for (let i = 0; i < 40; i++) {
                const cols = (await db.listColumns({ databaseId: DATABASE_ID, tableId })).columns;
                const pending = plan.columns.filter((c) => cols.find((x) => x.key === c.key)?.status !== 'available');
                if (pending.length === 0) break;
                if (i === 39) throw new Error(`Columnas aún no disponibles: ${pending.map((p) => p.key).join(', ')}`);
                await sleep(1500);
            }
        }
        for (const i of plan.indexes) {
            if (existingIdx.has(i.key)) { log(`= ya existe índice ${plan.label}.${i.key}`); continue; }
            log(`${apply ? '+ crea' : '[vista previa] crearía'} índice ${plan.label}.${i.key} (${i.type})`);
            if (apply) await db.createIndex({ databaseId: DATABASE_ID, tableId, key: i.key, type: i.type, columns: i.columns, orders: i.columns.map(() => OrderBy.Asc) });
        }
    }
    if (!apply) log('\nNada se modificó. Repite con --apply para aplicar.');
}

if (process.argv[1] && process.argv[1].endsWith('appwrite-migrate.mjs')) {
    const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
    if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
        console.error('Faltan APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID o APPWRITE_API_KEY.');
        process.exit(1);
    }
    const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
    run(new TablesDB(client), { apply, rollback }).catch((e) => { console.error(e.message); process.exit(1); });
}
