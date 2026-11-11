// GENERADO por build-2-functions.mjs (plan gratuito: una sola función para estado, webhook de Stripe y administración).
// Enruta: 1) cabecera stripe-webhook -> webhook.js (la firma HMAC es la autenticación); 2) acciones de administración -> admin.js
// (que exige la etiqueta admin/staff en el servidor); 3) todo lo demás -> status.js.
import status from './status.js';
import webhook from './webhook.js';
import admin from './admin.js';

const ADMIN_ACTIONS = new Set(['whoami', 'listProducts', 'listCategories', 'saveProduct', 'setProductAvailability', 'adjustStock', 'stockMovements', 'listPayments', 'report', 'reconcileInventory', 'listUsers', 'setRole']);

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
