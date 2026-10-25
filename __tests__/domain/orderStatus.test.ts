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

    it("el cliente solo cancela pedidos pendientes", () => {
        expect(canCustomerCancel("pending")).toBe(true);
        for (const s of ["confirmed", "preparing", "on_the_way", "delivered", "cancelled", "x", null]) {
            expect(canCustomerCancel(s)).toBe(false);
        }
    });

    it("calcula el progreso y detecta estados finales/seguibles", () => {
        expect(PROGRESS_STEPS).toHaveLength(5);
        expect(getProgressIndex("pending")).toBe(0);
        expect(getProgressIndex("delivered")).toBe(4);
        expect(getProgressIndex("cancelled")).toBe(-1);
        expect(getProgressIndex("???")).toBe(-1);
        expect(isTerminalStatus("delivered")).toBe(true);
        expect(isTerminalStatus("preparing")).toBe(false);
        expect(isTrackable("on_the_way")).toBe(true);
        expect(isTrackable("preparing")).toBe(false);
    });
});
