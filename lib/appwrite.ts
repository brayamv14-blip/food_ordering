
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
    // Si no estan definidos, la app usa el modo directo SOLO PARA DESARROLLO.
    functions: {
        createOrder: process.env.EXPO_PUBLIC_FN_CREATE_ORDER ?? "",
        updateOrderStatus: process.env.EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS ?? "",
        updateDriverLocation: process.env.EXPO_PUBLIC_FN_UPDATE_DRIVER_LOCATION ?? "",
        staffApi: process.env.EXPO_PUBLIC_FN_STAFF_API ?? ""
    }
};

export const client = new Client();

console.log(
    "APPWRITE ENDPOINT:",
    appwriteConfig.endpoint
);

console.log(
    "APPWRITE PROJECT:",
    appwriteConfig.projectId
);

console.log(
    "APPWRITE PLATFORM:",
    appwriteConfig.platform
);

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
// CERRAR SESIÓN
// ======================================================

export const signOut = async () => {
    await account.deleteSession("current");
};


// ======================================================
// OBTENER USUARIO ACTUAL
// ======================================================

export const getCurrentUser = async () => {
    try {
        console.log(
            "1. getCurrentUser iniciado"
        );

        // Obtener cuenta de Appwrite
        const currentAccount = await account.get();

        console.log(
            "2. Cuenta obtenida:",
            currentAccount.$id
        );

        // Buscar el usuario en la tabla users
        const currentUser = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userCollectionId,
            queries: [
                Query.equal(
                    "accountId",
                    currentAccount.$id
                )
            ]
        });

        console.log(
            "3. Usuarios encontrados:",
            currentUser.rows.length
        );

        if (currentUser.rows.length === 0) {
            throw new Error(
                "No se encontró el usuario en la tabla de usuarios"
            );
        }

        return currentUser.rows[0];

    } catch (error) {
        console.log(
            "ERROR EN getCurrentUser:",
            error
        );

        throw error;
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
            categories: row.categories as string
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
        console.log("========== OBTENIENDO MIS PEDIDOS ==========");

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
        console.log("========== ACTUALIZANDO PERFIL ==========");
        console.log("User ID:", userId);

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

        console.log("PERFIL ACTUALIZADO:");
        console.log(updatedUser);

        return updatedUser;
    } catch (error) {
        console.log(
            "========== ERROR ACTUALIZANDO PERFIL =========="
        );
        console.log(error);
        throw error;
    }
};

