
import { LatLng } from "@/lib/domain/coordinates";

export type RouteResult =
    | {
          ok: true;
          points: LatLng[];
          distanceMeters: number | null;
          durationSeconds: number | null;
      }
    | {
          ok: false;
          reason: "not_configured" | "no_route" | "denied" | "quota" | "network";
      };

export const directionsKey = (): string =>
    process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY ?? "";

export const isRouteConfigured = (): boolean =>
    directionsKey().length > 0;

export async function fetchRoute(
    origin: LatLng,
    destination: LatLng,
    fetchImpl: typeof fetch = fetch
): Promise<RouteResult> {
    const key = directionsKey();

    if (!key) {
        return { ok: false, reason: "not_configured" };
    }

    const params = new URLSearchParams({
        waypoints:
            `${origin.latitude},${origin.longitude}|` +
            `${destination.latitude},${destination.longitude}`,
        mode: "drive",
        apiKey: key,
    });

    try {
        const res = await fetchImpl(
            `https://api.geoapify.com/v1/routing?${params.toString()}`
        );

        if (res.status === 401 || res.status === 403) {
            return { ok: false, reason: "denied" };
        }

        if (res.status === 429) {
            return { ok: false, reason: "quota" };
        }

        if (!res.ok) {
            return { ok: false, reason: "network" };
        }

        const data: any = await res.json();
        const feature = data?.features?.[0];
        const geometry = feature?.geometry;

        let coordinates: number[][] = [];

        if (geometry?.type === "LineString") {
            coordinates = geometry.coordinates ?? [];
        } else if (geometry?.type === "MultiLineString") {
            coordinates = (geometry.coordinates ?? []).flat();
        }

        const points: LatLng[] = coordinates
            .filter(
                (point: unknown) =>
                    Array.isArray(point) &&
                    typeof point[0] === "number" &&
                    typeof point[1] === "number"
            )
            .map(([longitude, latitude]: number[]) => ({
                latitude,
                longitude,
            }));

        if (points.length < 2) {
            return { ok: false, reason: "no_route" };
        }

        const distance = feature?.properties?.distance;
        const duration = feature?.properties?.time;

        return {
            ok: true,
            points,
            distanceMeters:
                typeof distance === "number" ? distance : null,
            durationSeconds:
                typeof duration === "number" ? duration : null,
        };
    } catch {
        return { ok: false, reason: "network" };
    }
}
