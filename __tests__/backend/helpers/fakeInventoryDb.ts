/**
 * Doble minimo en memoria de TablesDB para probar el inventario: rowId unico (409), decremento/incremento atomicos.
 * El parametro `min` de decrementRowColumn se IGNORA a proposito (el codigo ya no depende de el).
 *  - columnMin0 = true : emula una columna con minimo 0 que rechaza (400) un resultado negativo.
 *  - columnMin0 = false: emula una columna que admite negativos (el codigo debe detectar y compensar la sobreventa).
 */
export function fakeDb() {
    const tables: Record<string, any[]> = { menu: [], moves: [] };
    const err = (code: number, message: string) => Object.assign(new Error(message), { code });
    const find = (t: string, id: string) => tables[t].find((r) => r.$id === id);
    return {
        tables,
        failIncrement: false,
        columnMin0: true,
        failDecrementFor: null as string | null,
        async listRows({ tableId, queries = [] }: any) {
            return { rows: tables[tableId].filter((r) => queries.filter((q: any) => q.f).every((q: any) => q.v.includes(r[q.f]))) };
        },
        async createRow({ tableId, rowId, data }: any) {
            if (find(tableId, rowId)) throw err(409, "already exists");
            const row = { $id: rowId, ...data };
            tables[tableId].push(row);
            return row;
        },
        async getRow({ tableId, rowId }: any) {
            const r = find(tableId, rowId);
            if (!r) throw err(404, "not found");
            return r;
        },
        async deleteRow({ tableId, rowId }: any) {
            tables[tableId] = tables[tableId].filter((r) => r.$id !== rowId);
        },
        async decrementRowColumn({ tableId, rowId, column, value }: any) {
            if (this.failDecrementFor === rowId) throw new Error("db caida");
            const r = await this.getRow({ tableId, rowId });
            if (this.columnMin0 && r[column] - value < 0) throw err(400, "below minimum");
            r[column] -= value;
            return { ...r };
        },
        async incrementRowColumn({ tableId, rowId, column, value }: any) {
            if (this.failIncrement) throw new Error("down");
            const r = await this.getRow({ tableId, rowId });
            r[column] += value;
            return { ...r };
        }
    };
}
export const Query = { equal: (f: string, v: any) => ({ f, v: ([] as any[]).concat(v) }), limit: () => ({}) };
export const hash = (s: string) => Buffer.from(s).toString("hex").padEnd(64, "0");
