#!/usr/bin/env node
/**
 * V15 — preparación inicial (se ejecuta UNA vez, desde tu computadora, con una API key de servidor).
 *
 *   1) Crear la tienda base "main" (la que usan los productos y pedidos anteriores a V15):
 *        node scripts/v15-setup.mjs seed-store --name "Mi restaurante" [--address "..."] [--phone "55..."] [--lat 19.43 --lng -99.13] [--hours 09:00-22:00] [--fee 25] [--radius 8]          (vista previa)
 *        node scripts/v15-setup.mjs seed-store --name "Mi restaurante" --apply                                                                                                            (aplica)
 *
 *   2) Convertir a una cuenta EXISTENTE en superadministrador (único camino: la app nunca concede este rol):
 *        node scripts/v15-setup.mjs superadmin --email tu@correo.com            (vista previa)
 *        node scripts/v15-setup.mjs superadmin --email tu@correo.com --apply    (aplica)
 *
 * Variables: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY (la llave NO se imprime ni se guarda), y opcionales
 * APPWRITE_DATABASE_ID, APPWRITE_STORES_TABLE_ID (por omisión "stores"). Idempotente: repetirlo no duplica nada.
 */
import { Client, Query, TablesDB, Users } from 'node-appwrite';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined; };
const APPLY = rest.includes('--apply');

export async function seedStore({ db, DB, STORES, args, log = console.log }) {
    const name = (args.name || '').trim();
    if (name.length < 2) throw new Error('Falta --name (2 a 80 caracteres).');
    const exists = await db.getRow({ databaseId: DB, tableId: STORES, rowId: 'main' }).catch(() => null);
    if (exists) { log('= la tienda "main" ya existe; no se modifica.'); return { created: false }; }
    const num = (v) => (v === undefined ? undefined : Number(v));
    const data = {
        name: name.slice(0, 80), active: true, closed: false,
        ...(args.address ? { address: args.address.slice(0, 200) } : {}), ...(args.phone ? { phone: args.phone.slice(0, 20) } : {}),
        ...(args.hours ? { openHours: args.hours } : {}),
        ...(args.lat !== undefined && args.lng !== undefined ? { latitude: num(args.lat), longitude: num(args.lng) } : {}),
        ...(args.fee !== undefined ? { deliveryFee: num(args.fee) } : {}), ...(args.radius !== undefined ? { deliveryRadiusKm: num(args.radius) } : {})
    };
    if (!APPLY) { log(`[vista previa] crearía la tienda "main": ${JSON.stringify(data)}`); return { created: false, preview: true }; }
    await db.createRow({ databaseId: DB, tableId: STORES, rowId: 'main', data });
    log('+ tienda "main" creada. Productos y pedidos antiguos (sin storeId) pertenecen a ella.');
    return { created: true };
}

export async function makeSuperadmin({ users, email, apply = APPLY, log = console.log }) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) throw new Error('Falta --email.');
    const found = await users.list({ queries: [Query.equal('email', [e]), Query.limit(1)] });
    const u = found.users[0];
    if (!u) throw new Error('No existe una cuenta con ese correo. Regístrala primero desde la app.');
    const labels = u.labels ?? [];
    if (labels.includes('superadmin')) { log('= esa cuenta ya es superadministrador.'); return { changed: false }; }
    if (!apply) { log(`[vista previa] agregaría la etiqueta superadmin a ${u.name || u.$id} (conserva: ${labels.join(', ') || 'ninguna'}).`); return { changed: false, preview: true }; }
    await users.updateLabels({ userId: u.$id, labels: [...labels, 'superadmin'] });
    log(`+ ${u.name || u.$id} ahora es superadministrador. Debe cerrar sesión y volver a entrar.`);
    return { changed: true };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
    const missing = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY'].filter((k) => !process.env[k]);
    if (missing.length) { console.error(`Faltan variables: ${missing.join(', ')}`); process.exit(2); }
    const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY);
    try {
        if (cmd === 'seed-store') {
            await seedStore({ db: new TablesDB(client), DB: process.env.APPWRITE_DATABASE_ID ?? '6ab6f27e000135138f89', STORES: process.env.APPWRITE_STORES_TABLE_ID ?? 'stores', args: { name: flag('name'), address: flag('address'), phone: flag('phone'), hours: flag('hours'), lat: flag('lat'), lng: flag('lng'), fee: flag('fee'), radius: flag('radius') } });
        } else if (cmd === 'superadmin') {
            await makeSuperadmin({ users: new Users(client), email: flag('email') });
        } else {
            console.error('Uso: node scripts/v15-setup.mjs seed-store|superadmin ... (ver la cabecera del archivo)');
            process.exit(2);
        }
        if (!APPLY) console.log('\nEsto fue una VISTA PREVIA. Agrega --apply para aplicar.');
    } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
}
