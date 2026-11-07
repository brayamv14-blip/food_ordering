import {
    ALLOWED_TRANSITIONS, ORDER_STATUSES, PROGRESS_STEPS, canCustomerCancel, canTransition,
    getProgressIndex, getStatusMeta, isTerminalStatus, isTrackable, parseOrderStatus
} from "@/lib/domain/orderStatus";

describe("estados del pedido", () => {
    it("define metadatos para los seis estados", () => {
        for (const s of ORDER_STATUSES) {
            const meta = getStatusMeta(s);
            expect(meta.label).not.toBe("Estado desconocido");
            expect(meta.icon).toBeTruthy();
            expect(meta.color).toMatch(/^#/);
        }
        expect(getStatusMeta("on_the_way").label).toBe("En camino");
    });

    it("normaliza mayúsculas/espacios y rechaza valores desconocidos", () => {
        expect(parseOrderStatus(" Delivered ")).toBe("delivered");
        expect(parseOrderStatus("enviado")).toBeNull();
        expect(parseOrderStatus(undefined)).toBeNull();
        expect(parseOrderStatus(42)).toBeNull();
        expect(getStatusMeta("enviado").label).toBe("Estado desconocido");
    });

    it("solo permite el flujo definido de transiciones", () => {
        expect(canTransition("pending", "confirmed")).toBe(true);
        expect(canTransition("preparing", "on_the_way")).toBe(true);
        expect(canTransition("pending", "delivered")).toBe(false);
        expect(canTransition("delivered", "cancelled")).toBe(false);
        expect(canTransition("cancelled", "pending")).toBe(false);
        expect(canTransition("basura", "pending")).toBe(false);
        expect(ALLOWED_TRANSITIONS.delivered).toHaveLength(0);
    });

    it("incluye listo para recoger (opcional) y entrega fallida", () => {
        expect(canTransition("preparing", "ready")).toBe(true);
        expect(canTransition("preparing", "on_the_way")).toBe(true); // `ready` no es obligatorio
        expect(canTransition("ready", "on_the_way")).toBe(true);
        expect(canTransition("ready", "delivered")).toBe(false);
        expect(canTransition("on_the_way", "delivery_failed")).toBe(true);
        expect(canTransition("delivery_failed", "on_the_way")).toBe(true);
        expect(canTransition("delivery_failed", "cancelled")).toBe(true);
        expect(canTransition("delivery_failed", "delivered")).toBe(false);
        expect(isTerminalStatus("delivery_failed")).toBe(false);
        expect(isTrackable("delivery_failed")).toBe(false);
        expect(getStatusMeta("ready").label).toBe("Listo para recoger");
        expect(getStatusMeta("delivery_failed").label).toBe("Entrega fallida");
    });

    it("el cliente solo cancela pedidos pendientes", () => {
        expect(canCustomerCancel("pending")).toBe(true);
        for (const s of ["confirmed", "preparing", "ready", "on_the_way", "delivery_failed", "delivered", "cancelled", "x", null]) {
            expect(canCustomerCancel(s)).toBe(false);
        }
    });

    it("calcula el progreso y detecta estados finales/seguibles", () => {
        expect(PROGRESS_STEPS).toHaveLength(6);
        expect(getProgressIndex("pending")).toBe(0);
        expect(getProgressIndex("delivered")).toBe(5);
        expect(getProgressIndex("ready")).toBe(3);
        expect(getProgressIndex("delivery_failed")).toBe(-1);
        expect(getProgressIndex("cancelled")).toBe(-1);
        expect(getProgressIndex("???")).toBe(-1);
        expect(isTerminalStatus("delivered")).toBe(true);
        expect(isTerminalStatus("preparing")).toBe(false);
        expect(isTrackable("on_the_way")).toBe(true);
        expect(isTrackable("preparing")).toBe(false);
    });
});
