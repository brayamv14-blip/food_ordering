
import {
    Account,
    Avatars,
    Client,
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
    orderItemsCollectionId: "6ab7281f0039efe022c2"
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
// CREAR PEDIDO
// ======================================================

export const createOrder = async ({
    userId,
    total,
    deliveryFee,
    discount,
    paymentMethod,
    items
}: {
    userId: string;
    total: number;
    deliveryFee: number;
    discount: number;
    paymentMethod: string;

    items: {
        menuId: string;
        name: string;
        price: number;
        quantity: number;
        customizations: string;
    }[];
}) => {
    try {

        // Crear pedido principal
        const order = await databases.createRow({
            databaseId: appwriteConfig.databaseId,

            tableId:
                appwriteConfig.ordersCollectionId,

            rowId:
                ID.unique(),

            data: {
                userId,
                status: "pending",
                total,
                deliveryFee,
                discount,
                paymentMethod
            }
        });

        // Crear productos del pedido
        await Promise.all(
            items.map((item) =>
                databases.createRow({
                    databaseId:
                        appwriteConfig.databaseId,

                    tableId:
                        appwriteConfig.orderItemsCollectionId,

                    rowId:
                        ID.unique(),

                    data: {
                        orderId: order.$id,
                        menuId: item.menuId,
                        name: item.name,
                        price: item.price,
                        quantity: item.quantity,
                        customizations:
                            item.customizations
                    }
                })
            )
        );

        return order;

    } catch (error) {
        console.log(
            "Error al crear pedido:",
            error
        );

        throw error;
    }
};

export const getMyOrders = async (userId: string) => {
    try {
        console.log("========== OBTENIENDO MIS PEDIDOS ==========");
        console.log("User ID:", userId);

        const orders = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.ordersCollectionId,
            queries: [
                Query.equal("userId", userId)
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

        console.log(
            "Pedidos con productos:",
            ordersWithItems
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
export const cancelOrder = async (orderId: string) => {
    try {
        console.log("========== CANCELANDO PEDIDO ==========");
        console.log("Order ID:", orderId);

        const order = await databases.updateRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.ordersCollectionId,
            rowId: orderId,
            data: {
                status: "cancelled"
            }
        });

        console.log("PEDIDO CANCELADO:");
        console.log(order);

        return order;
    } catch (error) {
        console.log("========== ERROR CANCELANDO PEDIDO ==========");
        console.log(error);
        throw error;
    }
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

