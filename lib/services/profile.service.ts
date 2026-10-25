import { databases, appwriteConfig } from "@/lib/appwrite";
import { ProfileInput, validateProfile } from "@/lib/domain/address";
import { DeliveryAddress } from "@/lib/domain/address";
import { toFiniteNumber } from "@/lib/domain/coordinates";

export interface Profile extends ProfileInput {
    rowId: string;
    accountId: string;
    avatar: string;
    /** Direccion preferida para el checkout. */
    selectedAddress: "home" | "work";
    homeLatitude: number | null;
    homeLongitude: number | null;
    workLatitude: number | null;
    workLongitude: number | null;
}

type Row = Record<string, unknown>;

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Convierte la fila de `users` en Profile. Mantiene address1/address2 de Sprint 1. */
export function mapProfileRow(row: Row): Profile {
    return {
        rowId: s(row.$id),
        accountId: s(row.accountId),
        avatar: s(row.avatar),
        name: s(row.name),
        email: s(row.email),
        phone: s(row.phone),
        homeAddress: s(row.address1),
        workAddress: s(row.address2),
        selectedAddress: row.selectedAddress === "work" ? "work" : "home",
        homeLatitude: toFiniteNumber(row.homeLatitude),
        homeLongitude: toFiniteNumber(row.homeLongitude),
        workLatitude: toFiniteNumber(row.workLatitude),
        workLongitude: toFiniteNumber(row.workLongitude)
    };
}

/** Direcciones disponibles para elegir en el checkout. */
export function listSelectableAddresses(profile: Profile): DeliveryAddress[] {
    const out: DeliveryAddress[] = [];
    if (profile.homeAddress.trim()) {
        out.push({
            label: "home",
            line: profile.homeAddress,
            latitude: profile.homeLatitude,
            longitude: profile.homeLongitude
        });
    }
    if ((profile.workAddress ?? "").trim()) {
        out.push({
            label: "work",
            line: profile.workAddress ?? "",
            latitude: profile.workLatitude,
            longitude: profile.workLongitude
        });
    }
    return out;
}

export class ProfileValidationError extends Error {
    errors: Record<string, string>;
    constructor(errors: Record<string, string>) {
        super("Revisa los datos del perfil.");
        this.name = "ProfileValidationError";
        this.errors = errors;
    }
}

export async function saveProfile(
    rowId: string,
    input: ProfileInput,
    extras: Partial<Pick<Profile, "selectedAddress" | "homeLatitude" | "homeLongitude" | "workLatitude" | "workLongitude">> = {}
) {
    const result = validateProfile(input);
    if (!result.valid) {
        throw new ProfileValidationError(result.errors as Record<string, string>);
    }
    const v = result.values;
    // Solo se escribe la fila propia; los permisos de la tabla impiden otras.
    return databases.updateRow({
        databaseId: appwriteConfig.databaseId,
        tableId: appwriteConfig.userCollectionId,
        rowId,
        data: {
            name: v.name,
            phone: v.phone,
            address1: v.homeAddress,
            address2: v.workAddress ?? "",
            ...extras
        }
    });
}
