import { spawnSync } from "child_process";
import path from "path";

/**
 * SIMULACIÓN (no es Appwrite ni Stripe reales): ejecuta las 4 Functions contra un doble en memoria de node-appwrite y de
 * la API de Stripe. Cubre autorización por rol, estados, inventario (compras simultáneas, rollback, devoluciones
 * idempotentes), webhooks duplicados/fuera de orden, reembolsos, asignaciones concurrentes y errores parciales.
 * Cada escenario imprime "OK"/"FALLA"; aquí se exige 0 fallas y un mínimo de escenarios para que nadie "borre" pruebas.
 */
describe("simulación de las Appwrite Functions (doble en memoria)", () => {
    it("todos los escenarios pasan", () => {
        const script = path.join(__dirname, "../../appwrite-functions/smoke-test/run-smoke.mjs");
        const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
        const out = `${r.stdout}\n${r.stderr}`;
        const failures = out.split("\n").filter((l) => l.startsWith("FALLA"));
        expect(failures).toEqual([]);
        const m = out.match(/(\d+) ok, (\d+) fallas/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(280);
        expect(Number(m![2])).toBe(0);
        expect(r.status).toBe(0);
    });
});
