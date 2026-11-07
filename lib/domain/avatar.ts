/** Validacion de la foto de perfil (pura, sin dependencias de Appwrite). */

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface PickedImage {
    uri?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    fileSize?: number | null;
}

export type AvatarCheck =
    | { ok: true; file: { name: string; type: string; size: number; uri: string } }
    | { ok: false; message: string };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function validateAvatarAsset(asset: PickedImage | null | undefined): AvatarCheck {
    if (!asset?.uri) return { ok: false, message: "No se pudo leer la imagen elegida." };
    const type = (asset.mimeType ?? "").toLowerCase();
    if (!(AVATAR_TYPES as readonly string[]).includes(type)) {
        return { ok: false, message: "Usa una imagen JPG, PNG o WebP." };
    }
    const size = asset.fileSize ?? 0;
    if (!Number.isFinite(size) || size <= 0) {
        return { ok: false, message: "No se pudo determinar el tamaño de la imagen." };
    }
    if (size > AVATAR_MAX_BYTES) {
        return { ok: false, message: "La imagen pesa más de 5 MB. Elige una más ligera." };
    }
    const name = (asset.fileName && asset.fileName.trim()) || `avatar.${EXT[type]}`;
    return { ok: true, file: { name, type, size, uri: asset.uri } };
}

/** Extrae el id de archivo si la URL pertenece al bucket indicado; si no, null. */
export function fileIdFromAvatarUrl(url: unknown, bucketId: string): string | null {
    if (typeof url !== "string") return null;
    const m = url.match(/\/storage\/buckets\/([^/]+)\/files\/([^/?#]+)\//);
    return m && m[1] === bucketId ? m[2] : null;
}
