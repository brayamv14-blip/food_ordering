// Equivalente en Node de sync-shared.sh (para Windows, sin bash).
// Copia shared/rules.js como src/rules.js (ESM) en cada funcion. Uso: node appwrite-functions/sync-shared.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'shared', 'rules.js'), 'utf8').replace(/\r\n/g, '\n');
const esm = src.replace(/module\.exports = \{([\s\S]*?)\};\s*$/, 'export {$1};\n');
if (esm === src) { console.error('No se encontro "module.exports = {...};" al final de shared/rules.js'); process.exit(1); }
const out = '// ARCHIVO GENERADO por sync-shared.sh a partir de shared/rules.js. No editar a mano.\n' + esm;
for (const f of ['create-order', 'update-order-status', 'stripe-webhook', 'admin-api']) {
    writeFileSync(join(here, f, 'src', 'rules.js'), out);
}
console.log('rules.js sincronizado en 4 funciones');
