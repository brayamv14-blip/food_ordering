import { Alert } from "react-native";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, any> = {};
jest.mock("expo-router", () => ({
    router: { replace: (...a: any[]) => mockReplace(...a), push: (...a: any[]) => mockPush(...a), back: jest.fn() },
    Link: ({ children }: any) => children,
    useLocalSearchParams: () => mockParams
}));
jest.mock("@sentry/react-native", () => ({ captureException: jest.fn() }));
const mockCreateUser = jest.fn(), mockSignIn = jest.fn(), mockRequestRecovery = jest.fn(), mockCompleteRecovery = jest.fn();
jest.mock("@/lib/appwrite", () => {
    class RecoveryNotConfiguredError extends Error {}
    return {
        __esModule: true,
        RecoveryNotConfiguredError,
        createUser: (...a: any[]) => mockCreateUser(...a),
        signIn: (...a: any[]) => mockSignIn(...a),
        requestPasswordRecovery: (...a: any[]) => mockRequestRecovery(...a),
        completePasswordRecovery: (...a: any[]) => mockCompleteRecovery(...a),
        getCurrentUser: jest.fn()
    };
});

import SignUp from "@/app/(auth)/sign-up";
import SignIn from "@/app/(auth)/sign-in";
import ForgotPassword from "@/app/(auth)/forgot-password";
import ResetPassword from "@/app/(auth)/reset-password";
import MenuCard from "@/components/MenuCard";
import useAppwrite from "@/lib/useAppwrite";
import useAuthStore from "@/store/auth.store";
import { useCartStore } from "@/store/cart.store";

const fetchUser = jest.fn();
beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    useAuthStore.setState({ fetchAuthenticatedUser: fetchUser } as any);
    fetchUser.mockResolvedValue(undefined);
    useCartStore.setState({ items: [] });
});

describe("registro (pantalla)", () => {
    const fill = () => {
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu nombre completo"), " Bryan ");
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), " b@c.com ");
        fireEvent.changeText(screen.getByPlaceholderText(/Escribe tu contraseña/), "12345678");
    };

    it("tras registrarse actualiza la sesión antes de navegar (evita volver a iniciar sesión)", async () => {
        mockCreateUser.mockResolvedValue({});
        render(<SignUp />);
        fill();
        fireEvent.press(screen.getByText("Crear cuenta"));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
        expect(mockCreateUser).toHaveBeenCalledWith({ email: "b@c.com", password: "12345678", name: "Bryan" });
        expect(fetchUser).toHaveBeenCalledTimes(1);
        expect(fetchUser.mock.invocationCallOrder[0]).toBeLessThan(mockReplace.mock.invocationCallOrder[0]);
    });

    it("valida en español sin llamar al servidor", () => {
        render(<SignUp />);
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), "mal");
        fireEvent.press(screen.getByText("Crear cuenta"));
        expect(Alert.alert).toHaveBeenCalledWith("Revisa tus datos", expect.stringMatching(/nombre|correo/));
        expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it("muestra un error comprensible si el correo ya existe", async () => {
        mockCreateUser.mockRejectedValue(Object.assign(new Error("A user with the same id, email, or phone already exists"), { code: 409 }));
        render(<SignUp />);
        fill();
        fireEvent.press(screen.getByText("Crear cuenta"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("No se pudo crear la cuenta", "Ya existe una cuenta con ese correo."));
        expect(mockReplace).not.toHaveBeenCalled();
    });
});

describe("inicio de sesión (pantalla)", () => {
    it("credenciales incorrectas muestran error en español y no navegan", async () => {
        mockSignIn.mockRejectedValue(Object.assign(new Error("Invalid credentials. Please check the email and password."), { code: 401 }));
        render(<SignIn />);
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), "b@c.com");
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu contraseña"), "mala");
        fireEvent.press(screen.getByText("Iniciar sesión"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("No se pudo iniciar sesión", "Correo o contraseña incorrectos."));
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it("con credenciales válidas actualiza la sesión y entra", async () => {
        mockSignIn.mockResolvedValue(undefined);
        render(<SignIn />);
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), "b@c.com");
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu contraseña"), "12345678");
        fireEvent.press(screen.getByText("Iniciar sesión"));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
        expect(fetchUser).toHaveBeenCalled();
    });
});

describe("tarjeta de producto", () => {
    const item = { $id: "m1", $createdAt: "", $updatedAt: "", name: "Burger", price: 10, image_url: "x", description: "", calories: 1, protein: 1, rating: 5 };
    it("agrega al carrito un producto disponible", () => {
        render(<MenuCard item={item} />);
        fireEvent.press(screen.getByLabelText("Agregar Burger al carrito"));
        expect(useCartStore.getState().items).toHaveLength(1);
    });
    it("un producto agotado se muestra como no disponible y no se puede agregar", () => {
        render(<MenuCard item={{ ...item, available: false }} />);
        expect(screen.getByText("No disponible")).toBeTruthy();
        expect(screen.queryByLabelText("Agregar Burger al carrito")).toBeNull();
        expect(useCartStore.getState().items).toHaveLength(0);
    });
});

describe("carga de catálogo (useAppwrite)", () => {
    it("un fallo se expone como mensaje en español, sin alertas en inglés", async () => {
        const fn = jest.fn().mockRejectedValue(new Error("Network request failed"));
        const { result } = renderHook(() => useAppwrite({ fn, params: {} as any }));
        await waitFor(() => expect(result.current.error).toMatch(/Revisa tu conexión/));
        expect(result.current.loading).toBe(false);
        expect(Alert.alert).not.toHaveBeenCalled();
    });
    it("reintentar limpia el error y carga los datos", async () => {
        const fn = jest.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue([{ $id: "1" }]);
        const { result } = renderHook(() => useAppwrite({ fn, params: {} as any }));
        await waitFor(() => expect(result.current.error).not.toBeNull());
        await result.current.refetch({} as any);
        await waitFor(() => expect(result.current.data).toEqual([{ $id: "1" }]));
        expect(result.current.error).toBeNull();
    });
});

describe("recuperación de contraseña (pantallas)", () => {
    const GOOD = { userId: "64f1a2b3c4d5e6f7a8b9", secret: "abcdef0123456789abcdef0123456789" };

    it("pide un correo válido antes de enviar", () => {
        render(<ForgotPassword />);
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), "mal");
        fireEvent.press(screen.getByText("Enviar enlace"));
        expect(Alert.alert).toHaveBeenCalledWith("Revisa tus datos", expect.stringMatching(/correo/));
        expect(mockRequestRecovery).not.toHaveBeenCalled();
    });

    it("envía el correo y avisa de que revise su bandeja", async () => {
        mockRequestRecovery.mockResolvedValue({});
        render(<ForgotPassword />);
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), "b@c.com");
        fireEvent.press(screen.getByText("Enviar enlace"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Revisa tu correo", expect.stringContaining("1 hora"), expect.any(Array)));
        expect(mockRequestRecovery).toHaveBeenCalledWith("b@c.com");
    });

    it("un correo sin cuenta (404) recibe el mismo aviso: no revela qué correos existen", async () => {
        mockRequestRecovery.mockRejectedValue(Object.assign(new Error("not found"), { code: 404 }));
        render(<ForgotPassword />);
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), "nadie@c.com");
        fireEvent.press(screen.getByText("Enviar enlace"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Revisa tu correo", expect.any(String), expect.any(Array)));
    });

    it("muestra el límite de intentos y la falta de configuración", async () => {
        mockRequestRecovery.mockRejectedValue(Object.assign(new Error("rate"), { code: 429 }));
        render(<ForgotPassword />);
        fireEvent.changeText(screen.getByPlaceholderText("Escribe tu correo"), "b@c.com");
        fireEvent.press(screen.getByText("Enviar enlace"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("No se pudo enviar el correo", expect.stringMatching(/Demasiados intentos/)));
        const { RecoveryNotConfiguredError } = jest.requireMock("@/lib/appwrite");
        mockRequestRecovery.mockRejectedValue(new RecoveryNotConfiguredError("Falta configurar EXPO_PUBLIC_RECOVERY_URL"));
        fireEvent.press(screen.getByText("Enviar enlace"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Configuración pendiente", expect.stringContaining("EXPO_PUBLIC_RECOVERY_URL")));
    });

    it("con el enlace profundo cambia la contraseña y lleva a iniciar sesión", async () => {
        mockParams = GOOD;
        mockCompleteRecovery.mockResolvedValue({});
        render(<ResetPassword />);
        expect(screen.queryByPlaceholderText("Pega aquí el enlace del correo")).toBeNull(); // ya vienen en el enlace
        fireEvent.changeText(screen.getByPlaceholderText("Mínimo 8 caracteres"), "nueva-clave-1");
        fireEvent.changeText(screen.getByPlaceholderText("Repite la contraseña"), "nueva-clave-1");
        fireEvent.press(screen.getByText("Cambiar contraseña"));
        await waitFor(() => expect(mockCompleteRecovery).toHaveBeenCalledWith({ ...GOOD, password: "nueva-clave-1" }));
        (Alert.alert as jest.Mock).mock.calls.at(-1)[2][0].onPress();
        expect(mockReplace).toHaveBeenCalledWith("/sign-in");
    });

    it("sin enlace profundo acepta el enlace pegado y rechaza uno inválido", async () => {
        mockCompleteRecovery.mockResolvedValue({});
        render(<ResetPassword />);
        fireEvent.changeText(screen.getByPlaceholderText("Mínimo 8 caracteres"), "nueva-clave-1");
        fireEvent.changeText(screen.getByPlaceholderText("Repite la contraseña"), "nueva-clave-1");
        fireEvent.press(screen.getByText("Cambiar contraseña"));
        expect(Alert.alert).toHaveBeenCalledWith("Enlace no válido", expect.any(String));
        expect(mockCompleteRecovery).not.toHaveBeenCalled();
        fireEvent.changeText(screen.getByPlaceholderText("Pega aquí el enlace del correo"), `https://x.github.io/r/?userId=${GOOD.userId}&secret=${GOOD.secret}`);
        fireEvent.press(screen.getByText("Cambiar contraseña"));
        await waitFor(() => expect(mockCompleteRecovery).toHaveBeenCalledWith({ ...GOOD, password: "nueva-clave-1" }));
    });

    it("valida que las contraseñas coincidan y explica un enlace vencido", async () => {
        mockParams = GOOD;
        render(<ResetPassword />);
        fireEvent.changeText(screen.getByPlaceholderText("Mínimo 8 caracteres"), "nueva-clave-1");
        fireEvent.changeText(screen.getByPlaceholderText("Repite la contraseña"), "otra-cosa-99");
        fireEvent.press(screen.getByText("Cambiar contraseña"));
        expect(Alert.alert).toHaveBeenCalledWith("Revisa tus datos", expect.stringMatching(/no coinciden/));
        expect(mockCompleteRecovery).not.toHaveBeenCalled();
        mockCompleteRecovery.mockRejectedValue(Object.assign(new Error("Invalid token"), { code: 401 }));
        fireEvent.changeText(screen.getByPlaceholderText("Repite la contraseña"), "nueva-clave-1");
        fireEvent.press(screen.getByText("Cambiar contraseña"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("No se pudo cambiar la contraseña", expect.stringMatching(/venció/)));
    });
});
