import { useEffect, useRef, useState } from "react";

import { LatLng } from "@/lib/domain/coordinates";
import { RouteRequestState, shouldRefetchRoute } from "@/lib/domain/polyline";
import { RouteResult, fetchRoute, isRouteConfigured } from "@/lib/services/directions";

/** Ruta real repartidor -> destino, con consultas limitadas. Sin clave no hace nada. */
export function useRoute(origin: LatLng | null, destination: LatLng | null) {
    const [route, setRoute] = useState<RouteResult | null>(null);
    const last = useRef<RouteRequestState | null>(null);
    const originLat = origin?.latitude;
    const originLng = origin?.longitude;
    const destLat = destination?.latitude;
    const destLng = destination?.longitude;

    useEffect(() => {
        if (originLat === undefined || originLng === undefined || destLat === undefined || destLng === undefined) {
            return;
        }
        if (!isRouteConfigured()) {
            setRoute({ ok: false, reason: "not_configured" });
            return;
        }
        const from = { latitude: originLat, longitude: originLng };
        const now = Date.now();
        if (!shouldRefetchRoute(last.current, from, now)) return;
        last.current = { origin: from, at: now };

        let cancelled = false;
        fetchRoute(from, { latitude: destLat, longitude: destLng }).then((r) => {
            if (!cancelled) setRoute(r);
        });
        return () => {
            cancelled = true;
        };
    }, [originLat, originLng, destLat, destLng]);

    return route;
}
