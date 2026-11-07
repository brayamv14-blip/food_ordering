import { startOrderWatcher } from "@/lib/domain/orderWatcher";
import { startDriverBroadcaster } from "@/lib/domain/driverBroadcaster";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("vigilante de pedido (tiempo real + consulta periódica)", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("consulta al iniciar, reacciona a eventos y consulta periódicamente", async () => {
        let onEvent: () => void = () => {};
        const fetch = jest.fn().mockResolvedValue({ n: 1 });
        const onUpdate = jest.fn();
        const unsubscribe = jest.fn();
        const w = startOrderWatcher({
            fetch, onUpdate, onError: jest.fn(), pollMs: 10000,
            subscribe: (cb) => { onEvent = cb; return unsubscribe; }
        });
        await flush();
        expect(fetch).toHaveBeenCalledTimes(1);
        onEvent();
        await flush();
        expect(fetch).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(10000);
        await flush();
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(onUpdate).toHaveBeenCalledTimes(3);
        w.stop();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("limpia timers y suscripción al detenerse (sin fugas)", async () => {
        const fetch = jest.fn().mockResolvedValue(1);
        const unsubscribe = jest.fn();
        const w = startOrderWatcher({ fetch, onUpdate: jest.fn(), onError: jest.fn(), subscribe: () => unsubscribe });
        await flush();
        w.stop();
        w.stop();
        jest.advanceTimersByTime(60000);
        await flush();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("reporta errores de red y se recupera en la siguiente consulta", async () => {
        const fetch = jest.fn().mockRejectedValueOnce(new Error("red")).mockResolvedValue("ok");
        const onError = jest.fn();
        const onUpdate = jest.fn();
        const w = startOrderWatcher({ fetch, onUpdate, onError, pollMs: 5000 });
        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(5000);
        await flush();
        expect(onUpdate).toHaveBeenCalledWith("ok");
        w.stop();
    });

    it("no solapa consultas y se detiene solo en estado final", async () => {
        let resolve!: (v: any) => void;
        const fetch = jest.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
        const onUpdate = jest.fn();
        const w = startOrderWatcher({ fetch, onUpdate, onError: jest.fn(), shouldStop: (v: any) => v.done });
        await flush();
        void w.refresh(); void w.refresh();
        expect(fetch).toHaveBeenCalledTimes(1);
        resolve({ done: true });
        await flush();
        expect(onUpdate).toHaveBeenCalledWith({ done: true });
        expect(jest.getTimerCount()).toBe(0);
    });

    it("sigue con consulta periódica si la suscripción falla", async () => {
        const onError = jest.fn();
        const fetch = jest.fn().mockResolvedValue(1);
        const w = startOrderWatcher({ fetch, onUpdate: jest.fn(), onError, subscribe: () => { throw new Error("ws"); } });
        await flush();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalled();
        w.stop();
    });
});

describe("envío de ubicación del repartidor (cada 5 s)", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const A = { latitude: 19.5, longitude: -99.2 };
    const FAR = { latitude: 19.5005, longitude: -99.2 };

    it("envía la primera posición y omite las que no se movieron", async () => {
        let t = 0;
        const getPosition = jest.fn().mockResolvedValue(A);
        const send = jest.fn().mockResolvedValue(undefined);
        const b = startDriverBroadcaster({ getPosition, send, onError: jest.fn(), now: () => t });
        await flush();
        expect(send).toHaveBeenCalledTimes(1);
        t = 5000; jest.advanceTimersByTime(5000); await flush();
        expect(send).toHaveBeenCalledTimes(1); // sin movimiento: no se reenvía
        getPosition.mockResolvedValue(FAR);
        t = 10000; jest.advanceTimersByTime(5000); await flush();
        expect(send).toHaveBeenCalledTimes(2);
        b.stop();
    });

    it("envía un latido aunque no haya movimiento tras 30 s", async () => {
        let t = 0;
        const send = jest.fn().mockResolvedValue(undefined);
        const b = startDriverBroadcaster({ getPosition: async () => A, send, onError: jest.fn(), now: () => t });
        await flush();
        t = 31000; jest.advanceTimersByTime(5000); await flush();
        expect(send).toHaveBeenCalledTimes(2);
        b.stop();
    });

    it("se detiene ante errores fatales (permiso/estado) y no ante errores de red", async () => {
        const onError = jest.fn();
        const send = jest.fn().mockRejectedValueOnce(new Error("red")).mockRejectedValue(Object.assign(new Error("no"), { code: 403 }));
        const b = startDriverBroadcaster({ getPosition: async () => A, send, onError });
        await flush();
        expect(onError).toHaveBeenLastCalledWith(expect.any(Error), false);
        expect(b.isRunning()).toBe(true);
        jest.advanceTimersByTime(5000); await flush();
        expect(onError).toHaveBeenLastCalledWith(expect.any(Error), true);
        expect(b.isRunning()).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("usa 5 s por omisión y mínimo 2 s", async () => {
        const getPosition = jest.fn().mockResolvedValue(FAR);
        const b = startDriverBroadcaster({ getPosition, send: async () => {}, onError: jest.fn(), intervalMs: 100 });
        await flush();
        jest.advanceTimersByTime(1999); await flush();
        expect(getPosition).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1); await flush();
        expect(getPosition).toHaveBeenCalledTimes(2);
        b.stop();
    });
});
