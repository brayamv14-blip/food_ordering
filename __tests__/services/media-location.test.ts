/** Foto de perfil, GPS y catálogo con dependencias externas simuladas. */
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("expo-location", () => ({
    getForegroundPermissionsAsync: jest.fn(),
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 }
}));
jest.mock("react-native-appwrite", () => ({
    ID: { unique: () => "newFile" },
    Permission: { read: (r: string) => `read(${r})`, update: (r: string) => `update(${r})`, delete: (r: string) => `delete(${r})` },
    Role: { any: () => "any", user: (u: string) => `user:${u}` },
    Query: { equal: (f: string, v: any) => `equal(${f},${v})`, limit: (n: number) => `limit(${n})` }
}));
jest.mock("@/lib/appwrite", () => {
    const mocks = {
        storage: { createFile: jest.fn(), getFileViewURL: jest.fn(), deleteFile: jest.fn() },
        databases: { updateRow: jest.fn(), listRows: jest.fn() }
    };
    return {
        __esModule: true,
        __mocks: mocks,
        storage: mocks.storage,
        databases: mocks.databases,
        appwriteConfig: { bucketId: "B1", databaseId: "db", userCollectionId: "users", menuCollectionId: "menu" }
    };
});

import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

import { changeAvatar } from "@/lib/services/avatar.service";
import { MAX_ACCEPTABLE_ACCURACY_M, getCurrentPosition, isPermissionFailure } from "@/lib/services/location";
import { findUnavailableItems } from "@/lib/services/catalog.service";

const { storage, databases } = jest.requireMock("@/lib/appwrite").__mocks;
const picker = ImagePicker.launchImageLibraryAsync as jest.Mock;
const L = Location as any;

describe("foto de perfil (servicio)", () => {
    const opts = { profileRowId: "row1", accountId: "acc1", currentAvatarUrl: "https://x/v1/storage/buckets/B1/files/OLD/view?project=p" };
    const asset = { uri: "file:///a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", fileSize: 1000 };
    beforeEach(() => {
        jest.clearAllMocks();
        picker.mockResolvedValue({ canceled: false, assets: [asset] });
        storage.createFile.mockResolvedValue({ $id: "NEW" });
        storage.getFileViewURL.mockReturnValue(new URL("https://x/v1/storage/buckets/B1/files/NEW/view?project=p"));
        storage.deleteFile.mockResolvedValue({});
        databases.updateRow.mockResolvedValue({});
    });

    it("sube la foto con permisos del dueño, guarda la URL y borra la anterior", async () => {
        const r = await changeAvatar(opts);
        expect(r).toMatchObject({ status: "updated" });
        const call = storage.createFile.mock.calls[0][0];
        expect(call.permissions).toEqual(["read(any)", "update(user:acc1)", "delete(user:acc1)"]);
        expect(databases.updateRow).toHaveBeenCalledWith(expect.objectContaining({ rowId: "row1", data: { avatar: expect.stringContaining("/files/NEW/") } }));
        expect(storage.deleteFile).toHaveBeenCalledWith({ bucketId: "B1", fileId: "OLD" });
    });
    it("cancelar el selector no cambia nada", async () => {
        picker.mockResolvedValue({ canceled: true, assets: null });
        expect(await changeAvatar(opts)).toEqual({ status: "cancelled" });
        expect(storage.createFile).not.toHaveBeenCalled();
    });
    it("rechaza archivos inválidos antes de subirlos", async () => {
        picker.mockResolvedValue({ canceled: false, assets: [{ ...asset, mimeType: "application/pdf" }] });
        expect(await changeAvatar(opts)).toMatchObject({ status: "error", message: expect.stringMatching(/JPG, PNG o WebP/) });
        picker.mockResolvedValue({ canceled: false, assets: [{ ...asset, fileSize: 6 * 1024 * 1024 }] });
        expect(await changeAvatar(opts)).toMatchObject({ status: "error", message: expect.stringMatching(/5 MB/) });
        expect(storage.createFile).not.toHaveBeenCalled();
    });
    it("un fallo de subida no toca el perfil ni borra la foto actual", async () => {
        storage.createFile.mockRejectedValue(new Error("Network request failed"));
        expect(await changeAvatar(opts)).toMatchObject({ status: "error", message: expect.stringMatching(/conexión/) });
        expect(databases.updateRow).not.toHaveBeenCalled();
        expect(storage.deleteFile).not.toHaveBeenCalled();
    });
    it("si no se puede guardar el enlace, borra el archivo nuevo (sin huérfanos) y conserva el anterior", async () => {
        databases.updateRow.mockRejectedValue(new Error("403"));
        expect(await changeAvatar(opts)).toMatchObject({ status: "error" });
        expect(storage.deleteFile).toHaveBeenCalledTimes(1);
        expect(storage.deleteFile).toHaveBeenCalledWith({ bucketId: "B1", fileId: "NEW" });
    });
    it("no borra fotos que no son del bucket de la app (p. ej. iniciales generadas)", async () => {
        await changeAvatar({ ...opts, currentAvatarUrl: "https://cloud.appwrite.io/v1/avatars/initials?name=B" });
        expect(storage.deleteFile).not.toHaveBeenCalled();
    });
    it("un error al borrar la foto anterior no falla la operación", async () => {
        storage.deleteFile.mockRejectedValue(new Error("404"));
        expect(await changeAvatar(opts)).toMatchObject({ status: "updated" });
    });
});

describe("GPS (servicio)", () => {
    const pos = (accuracy: number | null, lat = 19.5, lng = -99.2) => ({ coords: { latitude: lat, longitude: lng, accuracy } });
    beforeEach(() => {
        jest.clearAllMocks();
        L.getForegroundPermissionsAsync.mockResolvedValue({ status: "granted", canAskAgain: true });
        L.hasServicesEnabledAsync.mockResolvedValue(true);
        L.getCurrentPositionAsync.mockResolvedValue(pos(10));
    });

    it("devuelve coordenadas reales con su precisión", async () => {
        expect(await getCurrentPosition()).toEqual({ ok: true, coords: { latitude: 19.5, longitude: -99.2 }, accuracy: 10 });
        expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    });
    it("pide permiso si falta y distingue denegado de bloqueado", async () => {
        L.getForegroundPermissionsAsync.mockResolvedValue({ status: "undetermined", canAskAgain: true });
        L.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: true });
        expect(await getCurrentPosition()).toMatchObject({ ok: false, reason: "denied" });
        L.requestForegroundPermissionsAsync.mockResolvedValue({ status: "denied", canAskAgain: false });
        expect(await getCurrentPosition()).toMatchObject({ ok: false, reason: "blocked", message: expect.stringMatching(/ajustes/) });
        expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
        expect(isPermissionFailure("denied") && isPermissionFailure("blocked")).toBe(true);
        expect(isPermissionFailure("disabled") || isPermissionFailure("low_accuracy") || isPermissionFailure("unavailable")).toBe(false);
    });
    it("avisa cuando el GPS está apagado", async () => {
        L.hasServicesEnabledAsync.mockResolvedValue(false);
        expect(await getCurrentPosition()).toMatchObject({ ok: false, reason: "disabled" });
        expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
    });
    it("rechaza posiciones con precisión pobre", async () => {
        L.getCurrentPositionAsync.mockResolvedValue(pos(MAX_ACCEPTABLE_ACCURACY_M + 1));
        expect(await getCurrentPosition()).toMatchObject({ ok: false, reason: "low_accuracy", message: expect.stringMatching(/±101 m/) });
        L.getCurrentPositionAsync.mockResolvedValue(pos(MAX_ACCEPTABLE_ACCURACY_M));
        expect(await getCurrentPosition()).toMatchObject({ ok: true });
        L.getCurrentPositionAsync.mockResolvedValue(pos(null));
        expect(await getCurrentPosition()).toMatchObject({ ok: true, accuracy: null });
    });
    it("no acepta 0,0 ni errores del GPS como ubicación real", async () => {
        L.getCurrentPositionAsync.mockResolvedValue(pos(5, 0, 0));
        expect(await getCurrentPosition()).toMatchObject({ ok: false, reason: "unavailable" });
        L.getCurrentPositionAsync.mockRejectedValue(new Error("Location request timed out"));
        expect(await getCurrentPosition()).toMatchObject({ ok: false, reason: "unavailable" });
    });
});

describe("disponibilidad del catálogo (servicio)", () => {
    beforeEach(() => jest.clearAllMocks());
    const items = [{ id: "m1", name: "Burger" }, { id: "m2", name: "Pizza" }, { id: "m3", name: "Papas" }];
    it("detecta productos agotados o eliminados", async () => {
        databases.listRows.mockResolvedValue({ rows: [{ $id: "m1", available: true }, { $id: "m2", available: false }] });
        expect(await findUnavailableItems(items)).toEqual(["Pizza", "Papas"]); // m2 agotado, m3 ya no existe
    });
    it("sin columna available se considera disponible", async () => {
        databases.listRows.mockResolvedValue({ rows: [{ $id: "m1" }, { $id: "m2" }, { $id: "m3" }] });
        expect(await findUnavailableItems(items)).toEqual([]);
    });
    it("si la consulta falla devuelve null (el servidor valida igualmente)", async () => {
        databases.listRows.mockRejectedValue(new Error("Network request failed"));
        expect(await findUnavailableItems(items)).toBeNull();
        expect(await findUnavailableItems([])).toEqual([]);
    });
});
