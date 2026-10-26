import { ImageSourcePropType } from "react-native";

export interface MenuItem {
    $id: string;
    $createdAt: string;
    $updatedAt: string;
    name: string;
    price: number;
    image_url: string;
    description: string;
    calories: number;
    protein: number;
    rating: number;
    type?: string;
    categories?: string;
    /** false = agotado. Si la columna no existe se considera disponible. */
    available?: boolean;
}

export interface Category {
    $id: string;
    $createdAt: string;
    $updatedAt: string;
    name: string;
    description: string;
}

export interface User {
    $id: string;
    $createdAt: string;
    $updatedAt: string;
    name: string;
    email: string;
    avatar: string;
    accountId?: string;
}
export interface CartStore {
    items: CartItemType[];

    addItem: (
        item: Omit<CartItemType, "quantity">
    ) => void;

    updateItem: (
        id: string,
        oldCustomizations: CartCustomization[],
        item: Omit<CartItemType, "quantity">
    ) => void;

    removeItem: (
        id: string,
        customizations: CartCustomization[]
    ) => void;

    increaseQty: (
        id: string,
        customizations: CartCustomization[]
    ) => void;

    decreaseQty: (
        id: string,
        customizations: CartCustomization[]
    ) => void;

    clearCart: () => void;

    getTotalItems: () => number;

    getTotalPrice: () => number;
}
export interface CartCustomization {
    id: string;
    name: string;
    price: number;
    type: string;
}

export interface CartItemType {
    id: string;
    name: string;
    price: number;
    image_url: string;
    quantity: number;
    customizations?: CartCustomization[];
}

type.d.ts
export interface TabBarIconProps {
    focused: boolean;
    icon: ImageSourcePropType;
    title: string;
}

export interface PaymentInfoStripeProps {
    label: string;
    value: string;
    labelStyle?: string;
    valueStyle?: string;
}

export interface CustomButtonProps {
    onPress?: () => void;
    title?: string;
    style?: string;
    leftIcon?: React.ReactNode;
    textStyle?: string;
    isLoading?: boolean;
}

export interface CustomHeaderProps {
    title?: string;
}

export interface CustomInputProps {
    placeholder?: string;
    value?: string;
    onChangeText?: (text: string) => void;
    label: string;
    secureTextEntry?: boolean;
    keyboardType?:
        | "default"
        | "email-address"
        | "numeric"
        | "phone-pad";
}

export interface ProfileFieldProps {
    label: string;
    value: string;
    icon: ImageSourcePropType;
}

export interface CreateUserParams {
    email: string;
    password: string;
    name: string;
}

export interface SignInParams {
    email: string;
    password: string;
}

export interface GetMenuParams {
    category?: string;
    query?: string;
}