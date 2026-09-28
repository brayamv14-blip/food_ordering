import { ID } from "react-native-appwrite";
import { appwriteConfig, databases, storage } from "./appwrite";
import dummyData from "./data";

interface Category {
    name: string;
    description: string;
}

interface Customization {
    name: string;
    price: number;
    type: "topping" | "side" | "size" | "crust" | string;
}

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
    categories: Category[];
    customizations: Customization[];
    menu: MenuItem[];
}

const data = dummyData as DummyData;

async function clearAll(tableId: string): Promise<void> {
    const list = await databases.listRows({
        databaseId: appwriteConfig.databaseId,
        tableId,
    });

    await Promise.all(
        list.rows.map((row) =>
            databases.deleteRow({
                databaseId: appwriteConfig.databaseId,
                tableId,
                rowId: row.$id,
            })
        )
    );
}

async function clearStorage(): Promise<void> {
    const list = await storage.listFiles(appwriteConfig.bucketId);

    await Promise.all(
        list.files.map((file) =>
            storage.deleteFile(
                appwriteConfig.bucketId,
                file.$id
            )
        )
    );
}

async function uploadImageToStorage(imageUrl: string) {
    const response = await fetch(imageUrl);
    const blob = await response.blob();

    const fileObj = {
        name:
            imageUrl.split("/").pop() ||
            `file-${Date.now()}.jpg`,
        type: blob.type,
        size: blob.size,
        uri: imageUrl,
    };

    const file = await storage.createFile(
        appwriteConfig.bucketId,
        ID.unique(),
        fileObj
    );

    return storage.getFileViewURL(
        appwriteConfig.bucketId,
        file.$id
    );
}

async function seed(): Promise<void> {
    // 1. Clear all
    await clearAll(appwriteConfig.categoriesCollectionId);
    await clearAll(appwriteConfig.customizationsCollectionId);
    await clearAll(appwriteConfig.menuCollectionId);
    await clearAll(appwriteConfig.menuCustomizationsCollectionId);
    await clearStorage();

    // 2. Create Categories
    const categoryMap: Record<string, string> = {};

    for (const cat of data.categories) {
        const row = await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.categoriesCollectionId,
            rowId: ID.unique(),
            data: {
                name: cat.name,
                description: cat.description,
            },
        });

        categoryMap[cat.name] = row.$id;
    }

    // 3. Create Customizations
    const customizationMap: Record<string, string> = {};

    for (const cus of data.customizations) {
        const row = await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.customizationsCollectionId,
            rowId: ID.unique(),
            data: {
                name: cus.name,
                price: cus.price,
                type: cus.type,
            },
        });

        customizationMap[cus.name] = row.$id;
    }

    // 4. Create Menu Items
    const menuMap: Record<string, string> = {};

    for (const item of data.menu) {
        const uploadedImage =
            await uploadImageToStorage(item.image_url);

        const row = await databases.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.menuCollectionId,
            rowId: ID.unique(),
            data: {
                name: item.name,
                description: item.description,
                image_url: uploadedImage,
                price: item.price,
                rating: item.rating,
                calories: item.calories,
                protein: item.protein,
                categories:
                    categoryMap[item.category_name],
            },
        });

        menuMap[item.name] = row.$id;

        // 5. Create menu_customizations
        for (const cusName of item.customizations) {
            await databases.createRow({
                databaseId: appwriteConfig.databaseId,
                tableId:
                    appwriteConfig.menuCustomizationsCollectionId,
                rowId: ID.unique(),
                data: {
                    menu: row.$id,
                    customizations:
                        customizationMap[cusName],
                },
            });
        }
    }

    console.log("✅ Seeding complete.");
}

export default seed;