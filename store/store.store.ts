import { create } from "zustand";

/** v15: tienda elegida por el cliente. `enabled=false` => una sola tienda (V14): no se muestra selector ni se envia storeId. */
type StoreSelection = {
    enabled: boolean;
    storeId: string | null;
    storeName: string | null;
    setEnabled: (enabled: boolean) => void;
    select: (storeId: string, storeName: string) => void;
};

const useStoreSelection = create<StoreSelection>((set) => ({
    enabled: false,
    storeId: null,
    storeName: null,
    setEnabled: (enabled) => set({ enabled }),
    select: (storeId, storeName) => set({ storeId, storeName })
}));

export default useStoreSelection;
