const mockUpdate = jest.fn();
jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    get databases() { return { updateRow: mockUpdate }; },
    get appwriteConfig() { return { databaseId: "db", userCollectionId: "users" }; }
}));

import { ProfileValidationError, listSelectableAddresses, mapProfileRow, saveProfile } from "@/lib/services/profile.service";

const input = { name: "Bryan Pérez", email: "b@c.com", phone: "55 1234 5678", homeAddress: "Av. Reforma 123, Centro", workAddress: "" };

beforeEach(() => { jest.clearAllMocks(); mockUpdate.mockResolvedValue({}); });

describe("direcciones del perfil", () => {
    it("guarda la dirección y los datos normalizados solo en la fila indicada", async () => {
        await saveProfile("row1", input, { selectedAddress: "home", homeLatitude: 19.5, homeLongitude: -99.2 });
        expect(mockUpdate).toHaveBeenCalledWith({
            databaseId: "db", tableId: "users", rowId: "row1",
            data: expect.objectContaining({ name: "Bryan Pérez", phone: "5512345678", address1: "Av. Reforma 123, Centro", address2: "", selectedAddress: "home", homeLatitude: 19.5 })
        });
    });

    it("no escribe nada si la validación falla", async () => {
        await expect(saveProfile("row1", { ...input, phone: "1" })).rejects.toBeInstanceOf(ProfileValidationError);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("propaga el error de red al guardar", async () => {
        mockUpdate.mockRejectedValue(new Error("Network request failed"));
        await expect(saveProfile("row1", input)).rejects.toThrow("Network request failed");
    });

    it("mapea la fila y ofrece direcciones seleccionables para el checkout", () => {
        const p = mapProfileRow({ $id: "r", name: "B", email: "e", phone: "1", address1: "Casa 1234", address2: "Oficina 5678", selectedAddress: "work", workLatitude: "19.4", workLongitude: "-99.1" });
        expect(p.selectedAddress).toBe("work");
        const list = listSelectableAddresses(p);
        expect(list.map((a) => a.label)).toEqual(["home", "work"]);
        expect(list[1]).toMatchObject({ latitude: 19.4, longitude: -99.1 });
        expect(list[0].latitude).toBeNull();
    });

    it("sin direcciones guardadas la lista queda vacía (se escribe manualmente)", () => {
        expect(listSelectableAddresses(mapProfileRow({ $id: "r" }))).toEqual([]);
    });
});
