import { render, screen } from "@testing-library/react-native";

import OrderStatusBadge from "@/components/OrderStatusBadge";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";
import { ORDER_STATUSES, STATUS_META } from "@/lib/domain/orderStatus";

describe("estados del pedido en pantalla", () => {
    it.each(ORDER_STATUSES)("la etiqueta muestra la fase %s", (status) => {
        render(<OrderStatusBadge status={status} />);
        expect(screen.getByText(STATUS_META[status].label)).toBeTruthy();
    });

    it("un estado desconocido se muestra como tal en vez de fallar", () => {
        const first = render(<OrderStatusBadge status="algo_raro" />);
        expect(screen.getByText("Estado desconocido")).toBeTruthy();
        first.unmount();
        render(<OrderStatusBadge status={undefined} />);
        expect(screen.getByText("Estado desconocido")).toBeTruthy();
    });

    it("la línea de progreso marca el paso actual y los completados", () => {
        render(<OrderStatusTimeline status="preparing" />);
        expect(screen.getByLabelText("Pendiente, completado")).toBeTruthy();
        expect(screen.getByLabelText("Confirmado, completado")).toBeTruthy();
        expect(screen.getByLabelText("Preparando, paso actual")).toBeTruthy();
        expect(screen.getByLabelText("En camino, pendiente")).toBeTruthy();
        expect(screen.getByLabelText("Entregado, pendiente")).toBeTruthy();
    });

    it("un pedido entregado completa todos los pasos", () => {
        render(<OrderStatusTimeline status="delivered" />);
        expect(screen.getByLabelText("Entregado, paso actual")).toBeTruthy();
        expect(screen.queryByLabelText(/pendiente$/)).toBeNull();
    });

    it("cancelado y desconocido no dibujan el progreso normal", () => {
        const { unmount } = render(<OrderStatusTimeline status="cancelled" />);
        expect(screen.getByText("Cancelado")).toBeTruthy();
        expect(screen.queryByLabelText("Preparando, pendiente")).toBeNull();
        unmount();
        render(<OrderStatusTimeline status="???" />);
        expect(screen.getByText("Estado desconocido")).toBeTruthy();
    });
});
