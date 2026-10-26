#!/usr/bin/env node
/**
 * Migración de esquema de Appwrite para los Sprints 2 y 3.
 *
 * Vista previa:
 *   node scripts/appwrite-migrate.mjs
 *
 * Aplicar:
 *   node scripts/appwrite-migrate.mjs --apply
 *
 * Revertir lo que agrega:
 *   node scripts/appwrite-migrate.mjs --rollback --apply
 *
 * Requiere node-appwrite@22.1.1 y las variables:
 *   APPWRITE_ENDPOINT
 *   APPWRITE_PROJECT_ID
 *   APPWRITE_API_KEY
 *
 * La API Key debe ser de servidor y nunca debe incluirse
 * en la aplicación ni subirse al repositorio.
 *
 * IMPORTANTE:
 * Este script no se ha verificado contra el proyecto real
 * de Appwrite Cloud. Primero ejecuta la vista previa.
 */

import { Client, TablesDBIndexType, OrderBy, TablesDB } from 'node-appwrite';
const DATABASE_ID =
    process.env.APPWRITE_DATABASE_ID ?? '6ab6f27e000135138f89';

const ORDERS =
    process.env.APPWRITE_ORDERS_TABLE_ID ?? '6ab727bd00217e5c8f8d';

const USERS =
    process.env.APPWRITE_USERS_TABLE_ID ?? '6ab6f52f00317b447fbe';

const MENU =
    process.env.APPWRITE_MENU_TABLE_ID ?? '6ab6f3150012494438c2';

// Debe coincidir con ORDER_EVENTS_TABLE_ID de la Function.
const EVENTS =
    process.env.APPWRITE_ORDER_EVENTS_TABLE_ID ?? 'order_events';

const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');

const str = (key, size) => ({
    kind: 'string',
    key,
    size
});

const flt = (key, min, max) => ({
    kind: 'float',
    key,
    min,
    max
});

const dt = (key) => ({
    kind: 'datetime',
    key
});

const bool = (key, xdefault) => ({
    kind: 'bool',
    key,
    xdefault
});

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
            dt('driverUpdatedAt'),

            // Estado del pago verificado únicamente por el servidor.
            str('paymentStatus', 20),
            // PaymentIntent de Stripe (pi_...) una vez pagado.
            str('paymentId', 64),
            // Sesión de Stripe Checkout (cs_test_... / cs_live_..., puede superar 64 caracteres). La URL de pago NO se guarda.
            str('stripeSessionId', 128)
        ],

        indexes: [
            {
                key: 'uniq_clientRequestId',
                type: TablesDBIndexType.Unique,
                columns: ['clientRequestId']
            },
            {
                key: 'idx_userId',
                type: TablesDBIndexType.Key,
                columns: ['userId']
            },
            {
                key: 'idx_driverUserId',
                type: TablesDBIndexType.Key,
                columns: ['driverUserId']
            }
        ]
    },

    [MENU]: {
        label: 'menu',

        // available permite marcar productos como agotados.
        columns: [
            bool('available', true)
        ],

        indexes: []
    },

    [EVENTS]: {
        label: 'order_events',

        // Tabla nueva. No debe tener permisos de cliente.
        isNew: true,

        columns: [
            str('orderId', 36),
            str('type', 20),
            str('fromStatus', 20),
            str('toStatus', 20),
            str('actorId', 64),
            str('actorRole', 12),
            str('driverUserId', 64)
        ],

        indexes: [
            {
                key: 'idx_orderId',
                type: TablesDBIndexType.Key,
                columns: ['orderId']
            }
        ]
    },

    [USERS]: {
        label: 'users',

        columns: [
            str('selectedAddress', 10),
            flt('homeLatitude', -90, 90),
            flt('homeLongitude', -180, 180),
            flt('workLatitude', -90, 90),
            flt('workLongitude', -180, 180),

            // Token de notificaciones push.
            str('pushToken', 200)
        ],

        // Si existen accountId duplicados, este índice fallará.
        indexes: [
            {
                key: 'uniq_accountId',
                type: TablesDBIndexType.Unique,
                columns: ['accountId']
            }
        ]
    }
};

const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

export async function run(
    db,
    {
        apply,
        rollback,
        log = console.log
    }
) {
    for (const [tableId, plan] of Object.entries(PLAN)) {
        if (plan.isNew) {
            const tables = await db.listTables({
                databaseId: DATABASE_ID
            });

            const exists = tables.tables.some(
                (table) => table.$id === tableId
            );

            if (rollback) {
                if (exists) {
                    log(
                        apply
                            ? `ELIMINA tabla ${plan.label} COMPLETA (SE PIERDE TODO EL HISTORIAL)`
                            : `[vista previa] eliminaría tabla ${plan.label} COMPLETA`
                    );

                    if (apply) {
                        await db.deleteTable({
                            databaseId: DATABASE_ID,
                            tableId
                        });
                    }
                }

                continue;
            }

            if (!exists) {
                log(
                    apply
                        ? `+ crea tabla ${plan.label}`
                        : `[vista previa] crearía tabla ${plan.label}`
                );

                if (apply) {
                    await db.createTable({
                        databaseId: DATABASE_ID,
                        tableId,
                        name: plan.label,
                        permissions: [],
                        rowSecurity: false
                    });
                }
            } else {
                log(`= ya existe tabla ${plan.label}`);
            }

            if (!apply && !exists) {
                for (const column of plan.columns) {
                    log(
                        `[vista previa] crearía columna ${plan.label}.${column.key} (${column.kind})`
                    );
                }

                for (const index of plan.indexes) {
                    log(
                        `[vista previa] crearía índice ${plan.label}.${index.key}`
                    );
                }

                continue;
            }
        }

        const existingColumns = new Set(
            (
                await db.listColumns({
                    databaseId: DATABASE_ID,
                    tableId
                })
            ).columns.map((column) => column.key)
        );

        const existingIndexes = new Set(
            (
                await db.listIndexes({
                    databaseId: DATABASE_ID,
                    tableId
                })
            ).indexes.map((index) => index.key)
        );

        if (rollback) {
            for (const index of [...plan.indexes].reverse()) {
                if (!existingIndexes.has(index.key)) {
                    continue;
                }

                log(
                    apply
                        ? `ELIMINA índice ${plan.label}.${index.key}`
                        : `[vista previa] eliminaría índice ${plan.label}.${index.key}`
                );

                if (apply) {
                    await db.deleteIndex({
                        databaseId: DATABASE_ID,
                        tableId,
                        key: index.key
                    });
                }
            }

            if (apply) {
                await sleep(1500);
            }

            for (const column of plan.columns) {
                if (!existingColumns.has(column.key)) {
                    continue;
                }

                log(
                    apply
                        ? `ELIMINA columna ${plan.label}.${column.key} (SE PIERDEN SUS DATOS)`
                        : `[vista previa] eliminaría columna ${plan.label}.${column.key}`
                );

                if (apply) {
                    await db.deleteColumn({
                        databaseId: DATABASE_ID,
                        tableId,
                        key: column.key
                    });
                }
            }

            continue;
        }

        for (const column of plan.columns) {
            if (existingColumns.has(column.key)) {
                log(
                    `= ya existe columna ${plan.label}.${column.key}`
                );

                continue;
            }

            log(
                apply
                    ? `+ crea columna ${plan.label}.${column.key} (${column.kind})`
                    : `[vista previa] crearía columna ${plan.label}.${column.key} (${column.kind})`
            );

            if (!apply) {
                continue;
            }

            const base = {
                databaseId: DATABASE_ID,
                tableId,
                key: column.key,
                required: false
            };

            if (column.kind === 'string') {
                await db.createStringColumn({
                    ...base,
                    size: column.size
                });
            }

            if (column.kind === 'float') {
                await db.createFloatColumn({
                    ...base,
                    min: column.min,
                    max: column.max
                });
            }

            if (column.kind === 'datetime') {
                await db.createDatetimeColumn(base);
            }

            if (column.kind === 'bool') {
                await db.createBooleanColumn({
                    ...base,
                    xdefault: column.xdefault
                });
            }
        }

        if (apply && plan.indexes.length > 0) {
            // Esperar a que las columnas estén disponibles.
            for (let i = 0; i < 40; i++) {
                const columns = (
                    await db.listColumns({
                        databaseId: DATABASE_ID,
                        tableId
                    })
                ).columns;

                const pending = plan.columns.filter(
                    (column) =>
                        columns.find(
                            (current) => current.key === column.key
                        )?.status !== 'available'
                );

                if (pending.length === 0) {
                    break;
                }

                if (i === 39) {
                    throw new Error(
                        `Columnas aún no disponibles: ${pending
                            .map((column) => column.key)
                            .join(', ')}`
                    );
                }

                await sleep(1500);
            }
        }

        for (const index of plan.indexes) {
            if (existingIndexes.has(index.key)) {
                log(
                    `= ya existe índice ${plan.label}.${index.key}`
                );

                continue;
            }

            log(
                apply
                    ? `+ crea índice ${plan.label}.${index.key}`
                    : `[vista previa] crearía índice ${plan.label}.${index.key}`
            );

            if (apply) {
                await db.createIndex({
                    databaseId: DATABASE_ID,
                    tableId,
                    key: index.key,
                    type: index.type,
                    columns: index.columns,
                    orders: index.columns.map(() => OrderBy.Asc)
                });
            }
        }
    }

    if (!apply) {
        log('\nNada se modificó. Repite con --apply para aplicar.');
    }
}

if (
    process.argv[1] &&
    process.argv[1].endsWith('appwrite-migrate.mjs')
) {
    const {
        APPWRITE_ENDPOINT,
        APPWRITE_PROJECT_ID,
        APPWRITE_API_KEY
    } = process.env;

    if (
        !APPWRITE_ENDPOINT ||
        !APPWRITE_PROJECT_ID ||
        !APPWRITE_API_KEY
    ) {
        console.error(
            'Faltan APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID o APPWRITE_API_KEY.'
        );

        process.exit(1);
    }

    const client = new Client()
        .setEndpoint(APPWRITE_ENDPOINT)
        .setProject(APPWRITE_PROJECT_ID)
        .setKey(APPWRITE_API_KEY);

    run(new TablesDB(client), {
        apply,
        rollback
    }).catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
