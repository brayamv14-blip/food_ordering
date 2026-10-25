import * as ImagePicker from "expo-image-picker";
import { ID, Permission, Role } from "react-native-appwrite";

import { appwriteConfig, databases, storage } from "@/lib/appwrite";
import { fileIdFromAvatarUrl, validateAvatarAsset } from "@/lib/domain/avatar";

export type AvatarResult =
    | { status: "updated"; url: string }
    | { status: "cancelled" }
    | { status: "error"; message: string };

/**
 * Elige una foto, la sube al bucket de Appwrite y guarda su URL en la fila del perfil.
 * Las fotos de perfil quedan legibles para cualquiera con el enlace (necesario para
 * mostrarlas con <Image>); solo su dueno puede modificarlas o borrarlas.
 */
export async function changeAvatar(opts: {
    profileRowId: string;
    accountId: string;
    currentAvatarUrl?: string | null;
}): Promise<AvatarResult> {
    try {
        const picked = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7
        });
        if (picked.canceled) return { status: "cancelled" };

        const check = validateAvatarAsset(picked.assets?.[0]);
        if (!check.ok) return { status: "error", message: check.message };

        const bucketId = appwriteConfig.bucketId;
        const created = await storage.createFile({
            bucketId,
            fileId: ID.unique(),
            file: check.file,
            permissions: [
                Permission.read(Role.any()),
                Permission.update(Role.user(opts.accountId)),
                Permission.delete(Role.user(opts.accountId))
            ]
        });
        const url = storage.getFileViewURL(bucketId, created.$id).toString();

        try {
            await databases.updateRow({
                databaseId: appwriteConfig.databaseId,
                tableId: appwriteConfig.userCollectionId,
                rowId: opts.profileRowId,
                data: { avatar: url }
            });
        } catch (e) {
            // No dejar un archivo huerfano si no se pudo guardar el enlace.
            await storage.deleteFile({ bucketId, fileId: created.$id }).catch(() => {});
            throw e;
        }

        // Limpieza del archivo anterior (solo si lo habiamos subido nosotros).
        const oldId = fileIdFromAvatarUrl(opts.currentAvatarUrl, bucketId);
        if (oldId && oldId !== created.$id) {
            await storage.deleteFile({ bucketId, fileId: oldId }).catch(() => {});
        }
        return { status: "updated", url };
    } catch {
        return { status: "error", message: "No se pudo actualizar la foto. Revisa tu conexión e inténtalo de nuevo." };
    }
}
