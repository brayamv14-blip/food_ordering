import { CartCustomization, CartStore } from "@/type";
import { create } from "zustand";
import { MAX_ITEM_QUANTITY, isValidMoney } from "@/lib/domain/pricing";

/** Rechaza articulos con precios/identificadores manipulados o corruptos. */
function isValidCartItem(item: {
    id?: unknown;
    price?: unknown;
    customizations?: { id?: unknown; price?: unknown }[] | null;
}): boolean {
    if (typeof item?.id !== "string" || item.id.trim() === "") return false;
    if (!isValidMoney(item.price)) return false;
    return (item.customizations ?? []).every(
        (c) => typeof c?.id === "string" && c.id !== "" && isValidMoney(c.price)
    );
}

const capQty = (n: number) => Math.min(n, MAX_ITEM_QUANTITY);

function areCustomizationsEqual(
    a: CartCustomization[] = [],
    b: CartCustomization[] = []
): boolean {
    if (a.length !== b.length) return false;

    const aSorted = [...a].sort((x, y) =>
        x.id.localeCompare(y.id)
    );

    const bSorted = [...b].sort((x, y) =>
        x.id.localeCompare(y.id)
    );

    return aSorted.every(
        (item, idx) => item.id === bSorted[idx].id
    );
}

export const useCartStore = create<CartStore>((set, get) => ({
    items: [],

    addItem: (item) => {
        if (!isValidCartItem(item)) return;
        const customizations = item.customizations ?? [];

        const existing = get().items.find(
            (i) =>
                i.id === item.id &&
                areCustomizationsEqual(
                    i.customizations ?? [],
                    customizations
                )
        );

        if (existing) {
            set({
                items: get().items.map((i) =>
                    i.id === item.id &&
                    areCustomizationsEqual(
                        i.customizations ?? [],
                        customizations
                    )
                        ? {
                              ...i,
                              quantity: capQty(i.quantity + 1)
                          }
                        : i
                )
            });
        } else {
            set({
                items: [
                    ...get().items,
                    {
                        ...item,
                        quantity: 1,
                        customizations
                    }
                ]
            });
        }
    },

    updateItem: (
        id,
        oldCustomizations,
        item
    ) => {
        if (!isValidCartItem(item)) return;
        const currentItems = get().items;

        const updatedItems = currentItems.map((currentItem) => {
            const isItemToUpdate =
                currentItem.id === id &&
                areCustomizationsEqual(
                    currentItem.customizations ?? [],
                    oldCustomizations
                );

            if (!isItemToUpdate) {
                return currentItem;
            }

            return {
                ...item,
                quantity: currentItem.quantity,
                customizations: item.customizations ?? []
            };
        });

        set({
            items: updatedItems
        });
    },

    removeItem: (
        id,
        customizations = []
    ) => {
        set({
            items: get().items.filter(
                (i) =>
                    !(
                        i.id === id &&
                        areCustomizationsEqual(
                            i.customizations ?? [],
                            customizations
                        )
                    )
            )
        });
    },

    increaseQty: (
        id,
        customizations = []
    ) => {
        set({
            items: get().items.map((i) =>
                i.id === id &&
                areCustomizationsEqual(
                    i.customizations ?? [],
                    customizations
                )
                    ? {
                          ...i,
                          quantity: capQty(i.quantity + 1)
                      }
                    : i
            )
        });
    },

    decreaseQty: (
        id,
        customizations = []
    ) => {
        set({
            items: get()
                .items
                .map((i) =>
                    i.id === id &&
                    areCustomizationsEqual(
                        i.customizations ?? [],
                        customizations
                    )
                        ? {
                              ...i,
                              quantity: i.quantity - 1
                          }
                        : i
                )
                .filter(
                    (i) => i.quantity > 0
                )
        });
    },

    clearCart: () =>
        set({
            items: []
        }),

    getTotalItems: () =>
        get().items.reduce(
            (total, item) =>
                total + item.quantity,
            0
        ),

    getTotalPrice: () =>
        get().items.reduce(
            (total, item) => {
                const base = item.price;

                const customPrice =
                    item.customizations?.reduce(
                        (
                            sum: number,
                            customization: CartCustomization
                        ) =>
                            sum +
                            customization.price,
                        0
                    ) ?? 0;

                return (
                    total +
                    item.quantity *
                        (base + customPrice)
                );
            },
            0
        )
}));
