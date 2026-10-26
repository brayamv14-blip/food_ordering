export type DatePreset = "all" | "today" | "week";

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
    { key: "all", label: "Todas las fechas" },
    { key: "today", label: "Hoy" },
    { key: "week", label: "Últimos 7 días" }
];

/** Rango ISO para un filtro de fecha. `all` no limita. Usa la zona horaria local del telefono. */
export function dateRangeFor(preset: DatePreset, now: Date = new Date()): { from?: string } {
    if (preset === "all") return {};
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (preset === "week") start.setDate(start.getDate() - 6);
    return { from: start.toISOString() };
}

/** Normaliza lo que escribe el usuario en el buscador de pedidos. */
export function normalizeOrderQuery(raw: string): string | undefined {
    const q = (raw ?? "").trim().replace(/^#/, "");
    return q.length >= 4 ? q : undefined;
}

export const isOrderQueryTooShort = (raw: string): boolean => {
    const q = (raw ?? "").trim().replace(/^#/, "");
    return q.length > 0 && q.length < 4;
};
