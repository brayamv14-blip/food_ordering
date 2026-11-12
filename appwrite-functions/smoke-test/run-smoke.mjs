// Ejecuta la simulación de las 4 Functions con un doble en memoria de node-appwrite (multiplataforma: no necesita bash).
// Uso: node appwrite-functions/smoke-test/run-smoke.mjs   (lo invoca también Jest: __tests__/backend/functions.smoke.test.ts)
// IMPORTANTE: es una SIMULACIÓN (ni Appwrite ni Stripe reales): valida lógica de autorización, idempotencia y compensación.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fnRoot = join(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'fo-smoke-'));
try {
    mkdirSync(join(tmp, 'node_modules'), { recursive: true });
    cpSync(join(here, 'fake-node-appwrite'), join(tmp, 'node_modules', 'node-appwrite'), { recursive: true });
    for (const f of ['create-order', 'update-order-status', 'stripe-webhook', 'admin-api']) cpSync(join(fnRoot, f), join(tmp, f), { recursive: true });
    cpSync(join(fnRoot, 'plan-gratuito'), join(tmp, 'plan-gratuito'), { recursive: true });
    cpSync(join(here, 'run.mjs'), join(tmp, 'run.mjs'));
    writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
    const r = spawnSync(process.execPath, ['run.mjs'], { cwd: tmp, encoding: 'utf8' });
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    process.exitCode = r.status ?? 1;
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
