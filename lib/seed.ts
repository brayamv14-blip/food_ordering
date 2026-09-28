import { ID } from "react-native-appwrite";
import { appwriteConfig, databases } from "./appwrite";
import dummyData from "./data";

interface MenuItem {
    name: string;
    description: string;
    image_url: string;
    price: number;
    rating: number;
    calories: number;
    protein: number;
    category_name: string;
    customizations: string[];
}

interface DummyData {
    categories: {
        name: string;
        description: string;
    }[];

    customizations: {
        name: string;
        price: number;
        type: string;
    }[];

    menu: MenuItem[];
}

const data = dummyData as DummyData;

async function seed(): Promise<void> {
    console.log("🌱 INICIANDO SEED...");

    // =====================================================
    // 1. CREAR CATEGORÍAS
    // =====================================================

    console.log("📂 Creando categorías...");

    const categoryMap: Record<string, string> = {};

    for (const category of data.categories) {
        const row = await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.categoriesCollectionId,
            rowId: ID.unique(),
            data: {
                name: category.name,
                description: category.description,
            },
        });

        categoryMap[category.name] = row.$id;

        console.log(`✅ Categoría: ${category.name}`);
    }

    // =====================================================
    // 2. CREAR CUSTOMIZATIONS
    // =====================================================

    console.log("🧩 Creando customizations...");

    const customizationMap: Record<string, string> = {};

    for (const customization of data.customizations) {
        const row = await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.customizationsCollectionId,
            rowId: ID.unique(),
            data: {
                name: customization.name,
                price: customization.price,
                type: customization.type,
            },
        });

        customizationMap[customization.name] = row.$id;

        console.log(`✅ Customization: ${customization.name}`);
    }

    // =====================================================
    // 3. CREAR PRODUCTOS DEL MENÚ
    // =====================================================

    console.log("🍔 Creando productos...");

    for (const item of data.menu) {
        const categoryId = categoryMap[item.category_name];

        if (!categoryId) {
            console.log(
                `⚠️ Categoría no encontrada: ${item.category_name}`
            );
            continue;
        }

        const menuRow = await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.menuCollectionId,
            rowId: ID.unique(),
            data: {
                name: item.name,
                description: item.description,
                image_url: item.image_url,
                price: item.price,
                rating: item.rating,
                calories: item.calories,
                protein: item.protein,
                categories: categoryId,
            },
        });

        console.log(`✅ Producto: ${item.name}`);

        // =================================================
        // 4. CREAR RELACIONES CON CUSTOMIZATIONS
        // =================================================

        for (const customizationName of item.customizations) {
            const customizationId =
                customizationMap[customizationName];

            if (!customizationId) {
                console.log(
                    `⚠️ Customization no encontrada: ${customizationName}`
                );
                continue;
            }

            await databases.createRow({
                databaseId: appwriteConfig.databaseId,
                tableId:
                    appwriteConfig.menuCustomizationsCollectionId,
                rowId: ID.unique(),
                data: {
                    menu: menuRow.$id,
                    customizations: customizationId,
                },
            });
        }
    }

    console.log("================================");
    console.log("🎉 SEED COMPLETADO");
    console.log("================================");
}

export default seed;