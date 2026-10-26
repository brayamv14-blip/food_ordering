
import {
    Account,
    Avatars,
    Client,
    ExecutionMethod,
    Functions,
    TablesDB,
    ID,
    Query,
    Storage
} from "react-native-appwrite";

import {
    CreateUserParams,
    GetMenuParams,
    SignInParams,
    MenuItem,
    Category
} from "@/type";

export const appwriteConfig = {
    endpoint: process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT!,
    projectId: process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID!,
    platform: "com.jsm.foodordering",

    // Base de datos nueva
    databaseId: "6ab6f27e000135138f89",

    // Storage
    bucketId: "6ab6fa3a00059e1f950e",

    // Tablas nuevas
    userCollectionId: "6ab6f52f00317b447fbe",
    categoriesCollectionId: "6ab6f2e8000e2aaa09db",
    menuCollectionId: "6ab6f3150012494438c2",
    customizationsCollectionId: "6ab6f30d0011f3a49202",
    menuCustomizationsCollectionId: "6ab6f5020005536e0916",

    // Pedidos
    ordersCollectionId: "6ab727bd00217e5c8f8d",
    orderItemsCollectionId: "6ab7281f0039efe022c2",

    // Appwrite Functions (backend de confianza). Los IDs no son secretos.
    // Solo existen DOS funciones: `create-order` y `update-order-status`; esta ultima
    // atiende cambios de estado, ubicacion del repartidor y panel de personal (campo `action`).
    // Si no estan definidos, la app usa el modo directo SOLO PARA DESARROLLO.
    // URL https (hostname registrado como plataforma Web en Appwrite) a la que apunta el
    // correo de recuperacion; ver recovery-bridge/index.html.
    recoveryUrl: process.env.EXPO_PUBLIC_RECOVERY_URL ?? "",

    functions: {
        createOrder: process.env.EXPO_PUBLIC_FN_CREATE_ORDER ?? "",
        updateOrderStatus: process.env.EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS ?? ""
    }
};

export const client = new Client();

client
    .setEndpoint(appwriteConfig.endpoint)
    .setProject(appwriteConfig.projectId)
    .setPlatform(appwriteConfig.platform);

export const account = new Account(client);

export const databases = new TablesDB(client);

export const storage = new Storage(client);

export const functions = new Functions(client);

/**
 * Ejecuta una Appwrite Function de forma sincrona con cuerpo JSON.
 * Lanza un Error con el mensaje del backend si responde con codigo >= 400.
 */
export const callBackendFunction = async <T = unknown>(
    functionId: string,
    payload: Record<string, unknown>
): Promise<T> => {
    const execution = await functions.createExecution({
        functionId,
        body: JSON.stringify(payload),
        async: false,
        xpath: "/",
        method: ExecutionMethod.POST,
        headers: { "content-type": "application/json" }
    });

    let parsed: any = null;
    try {
        parsed = execution.responseBody ? JSON.parse(execution.responseBody) : null;
    } catch {
        parsed = null;
    }

    if (execution.responseStatusCode >= 400 || execution.status === "failed") {
        const error: any = new Error(
            parsed?.error ?? "El servidor rechazo la operacion"
        );
        error.code = parsed?.code ?? execution.responseStatusCode;
        throw error;
    }

    return parsed as T;
};

const avatars = new Avatars(client);


// ======================================================
// CREAR USUARIO
// ======================================================

export const createUser = async ({
    email,
    password,
    name
}: CreateUserParams) => {
    try {
        const newAccount = await account.create(
            ID.unique(),
            email,
            password,
            name
        );

        if (!newAccount) {
            throw new Error("No se pudo crear la cuenta");
        }

        // Iniciar sesión automáticamente
        await signIn({
            email,
            password
        });

        const avatarUrl = avatars.getInitialsURL(name);

        return await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userCollectionId,
            rowId: ID.unique(),
            data: {
                email,
                name,
                accountId: newAccount.$id,
                avatar: avatarUrl
            }
        });

    } catch (e) {
        console.log("Error al crear usuario:", e);

        throw e;
    }
};


// ======================================================
// INICIAR SESIÓN
// ======================================================

export const signIn = async ({
    email,
    password
}: SignInParams) => {
    try {
        // Comprobar si ya existe una sesión
        try {
            await account.get();

            // Si existe, eliminar la sesión anterior
            await account.deleteSession("current");

        } catch {
            // No existe una sesión activa
        }

        // Crear nueva sesión
        await account.createEmailPasswordSession(
            email,
            password
        );

    } catch (e) {
        console.log("Error al iniciar sesión:", e);

        throw e;
    }
};


// ======================================================
// RECUPERACIÓN DE CONTRASEÑA
// ======================================================

export class RecoveryNotConfiguredError extends Error {
    constructor() {
        super("Falta configurar EXPO_PUBLIC_RECOVERY_URL en .env.local.");
        this.name = "RecoveryNotConfiguredError";
    }
}

/** Envia el correo de recuperacion. El enlace dura 1 hora (lo define Appwrite). */
export const requestPasswordRecovery = async (email: string) => {
    if (!appwriteConfig.recoveryUrl) throw new RecoveryNotConfiguredError();
    return account.createRecovery({ email: email.trim(), url: appwriteConfig.recoveryUrl });
};

/** Completa la recuperacion con el userId y el secret recibidos en el enlace. */
export const completePasswordRecovery = async (params: {
    userId: string;
    secret: string;
    password: string;
}) => account.updateRecovery(params);


// ======================================================
// CERRAR SESIÓN
// ======================================================

export const signOut = async () => {
    await account.deleteSession("current");
};


// ======================================================
// OBTENER USUARIO ACTUAL
// ======================================================

let currentUserInFlight: ReturnType<typeof loadCurrentUser> | null = null;

/** Llamadas simultaneas (layout, perfil, checkout) comparten una sola consulta. */
export const getCurrentUser = () => {
    if (!currentUserInFlight) {
        currentUserInFlight = loadCurrentUser().finally(() => {
            currentUserInFlight = null;
        });
    }
    return currentUserInFlight;
};

const loadCurrentUser = async () => {
    // Lanza si no hay sesion; quien llama (auth store) lo trata como "sin sesion".
    const currentAccount = await account.get();

    const findProfile = async () => {
        const res = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userCollectionId,
            queries: [Query.equal("accountId", currentAccount.$id)]
        });
        return res.rows[0];
    };

    const existing = await findProfile();
    if (existing) return existing;

    // La cuenta existe pero su fila de perfil no (p. ej. fallo de red justo despues
    // de registrarse). Se crea una sola vez para no dejar al usuario sin acceso.
    try {
        return await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userCollectionId,
            rowId: ID.unique(),
            data: {
                email: currentAccount.email,
                name: currentAccount.name,
                accountId: currentAccount.$id,
                avatar: avatars.getInitialsURL(currentAccount.name || currentAccount.email)
            }
        });
    } catch (e) {
        // Otra peticion pudo crearla a la vez: se reutiliza.
        const created = await findProfile();
        if (created) return created;
        throw e;
    }
};


// ======================================================
// OBTENER MENÚ
// ======================================================

export const getMenu = async ({
    category,
    query
}: GetMenuParams): Promise<MenuItem[]> => {
    try {
        const queries: string[] = [];

        if (category) {
            queries.push(
                Query.equal(
                    "categories",
                    category
                )
            );
        }

        if (query) {
            queries.push(
                Query.search(
                    "name",
                    query
                )
            );
        }

        const menus = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.menuCollectionId,
            queries
        });

        return menus.rows.map((row) => ({
            $id: row.$id,
            $createdAt: row.$createdAt,
            $updatedAt: row.$updatedAt,

            name: row.name as string,
            price: row.price as number,
            image_url: row.image_url as string,
            description: row.description as string,
            calories: row.calories as number,
            protein: row.protein as number,
            rating: row.rating as number,
            categories: row.categories as string,
            available: row.available !== false
        }));

    } catch (e) {
        console.log(
            "Error al obtener menú:",
            e
        );

        throw e;
    }
};


// ======================================================
// OBTENER CATEGORÍAS
// ======================================================

export const getCategories = async (): Promise<Category[]> => {
    try {
        const categories = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.categoriesCollectionId
        });

        return categories.rows.map((row) => ({
            $id: row.$id,
            $createdAt: row.$createdAt,
            $updatedAt: row.$updatedAt,

            name: row.name as string,
            description: row.description as string
        }));

    } catch (e) {
        console.log(
            "Error al obtener categorías:",
            e
        );

        throw e;
    }
};


// ======================================================
// OBTENER PERSONALIZACIONES DEL PRODUCTO
// ======================================================

export const getProductCustomizations = async (
    menuId: string
) => {
    try {
        const relations = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.menuCustomizationsCollectionId,
            queries: [
                Query.equal(
                    "menu",
                    menuId
                )
            ]
        });

        const customizations = await Promise.all(
            relations.rows.map(
                async (relation) => {

                    const customization =
                        await databases.getRow({
                            databaseId:
                                appwriteConfig.databaseId,

                            tableId:
                                appwriteConfig.customizationsCollectionId,

                            rowId:
                                relation.customizations as string
                        });

                    return {
                        id: customization.$id,
                        name: customization.name as string,
                        price: customization.price as number,
                        type: customization.type as string
                    };
                }
            )
        );

        return customizations;

    } catch (error) {
        console.log(
            "Error al obtener personalizaciones:",
            error
        );

        throw error;
    }
};


// ======================================================
// CREAR PEDIDO -> ver lib/services/orders.service.ts (createOrderIdempotent)
// ======================================================

export const getMyOrders = async (userId: string) => {
    try {

        const orders = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.ordersCollectionId,
            queries: [
                Query.equal("userId", userId),
                Query.orderDesc("$createdAt"),
                Query.limit(50)
            ]
        });

        console.log("Pedidos encontrados:", orders.rows.length);

        const ordersWithItems = await Promise.all(
            orders.rows.map(async (order) => {
                const items = await databases.listRows({
                    databaseId: appwriteConfig.databaseId,
                    tableId:
                        appwriteConfig.orderItemsCollectionId,
                    queries: [
                        Query.equal(
                            "orderId",
                            order.$id
                        )
                    ]
                });

                return {
                    ...order,
                    items: items.rows
                };
            })
        );

        return ordersWithItems;
    } catch (error) {
        console.log(
            "Error al obtener mis pedidos:",
            error
        );

        throw error;
    }
};
/**
 * Cancela un pedido propio. Con backend configurado la regla "solo si esta
 * pendiente" se valida en el servidor; sin el, se hace una verificacion previa
 * en el cliente (SOLO DESARROLLO: no es una barrera de seguridad).
 */
export const cancelOrder = async (orderId: string) => {
    if (appwriteConfig.functions.updateOrderStatus) {
        return callBackendFunction(appwriteConfig.functions.updateOrderStatus, {
            action: "updateStatus",
            orderId,
            status: "cancelled"
        });
    }

    const current = await databases.getRow({
        databaseId: appwriteConfig.databaseId,
        tableId: appwriteConfig.ordersCollectionId,
        rowId: orderId
    });

    if (current.status !== "pending") {
        throw new Error("Este pedido ya no se puede cancelar.");
    }

    return databases.updateRow({
        databaseId: appwriteConfig.databaseId,
        tableId: appwriteConfig.ordersCollectionId,
        rowId: orderId,
        data: { status: "cancelled" }
    });
};
export const updateUserProfile = async ({
    userId,
    name,
    phone,
    address1,
    address2
}: {
    userId: string;
    name: string;
    phone: string;
    address1: string;
    address2: string;
}) => {
    try {
        const updatedUser = await databases.updateRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userCollectionId,
            rowId: userId,
            data: {
                name,
                phone,
                address1,
                address2
            }
        });

        return updatedUser;
    } catch (error) {
        console.log("Error al actualizar el perfil");
        throw error;
    }
};

