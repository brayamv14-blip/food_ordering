// Plan gratuito de Appwrite (2 funciones): genera appwrite-functions/plan-gratuito/{create-order,update-order-status}
// donde update-order-status atiende TAMBIÉN el webhook de Stripe y las acciones de administración.
// Uso: node appwrite-functions/build-2-functions.mjs   (después de editar cualquier función; corre antes sync-shared.sh)
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'plan-gratuito');
rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'create-order'), join(out, 'create-order'), { recursive: true });
const u = join(out, 'update-order-status');
cpSync(join(root, 'update-order-status'), u, { recursive: true });
cpSync(join(u, 'src', 'main.js'), join(u, 'src', 'status.js'));
cpSync(join(root, 'stripe-webhook', 'src', 'main.js'), join(u, 'src', 'webhook.js'));
cpSync(join(root, 'admin-api', 'src', 'main.js'), join(u, 'src', 'admin.js'));
mkdirSync(join(u, 'src'), { recursive: true });
writeFileSync(join(u, 'src', 'main.js'), `// GENERADO por build-2-functions.mjs (plan gratuito: una sola función para estado, webhook de Stripe y administración).
// Enruta: 1) cabecera stripe-webhook -> webhook.js (la firma HMAC es la autenticación); 2) acciones de administración -> admin.js
// (que exige la etiqueta admin/staff en el servidor); 3) todo lo demás -> status.js.
import status from './status.js';
import webhook from './webhook.js';
import admin from './admin.js';

const ADMIN_ACTIONS = new Set(['whoami', 'listProducts', 'listCategories', 'saveProduct', 'setProductAvailability', 'adjustStock', 'stockMovements', 'listPayments', 'report', 'reconcileInventory', 'listUsers', 'setRole', 'dashboard', 'saveCategory', 'setCategoryActive', 'deleteCategory', 'listCustomers', 'customerOrders', 'setUserStatus', 'listAudit']);

export default async (ctx) => {
    const { req } = ctx;
    if (req.headers?.['stripe-signature']) return webhook(ctx);
    let action = '';
    try {
        const body = typeof req.bodyJson === 'object' && req.bodyJson ? req.bodyJson : JSON.parse(req.bodyText || '{}');
        action = typeof body.action === 'string' ? body.action : '';
    } catch {
        /* el handler correspondiente responde 400 */
    }
    return ADMIN_ACTIONS.has(action) ? admin(ctx) : status(ctx);
};
`);
console.log('plan-gratuito generado: create-order + update-order-status (estado + webhook + admin)');
