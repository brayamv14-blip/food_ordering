import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Dimensions, FlatList, Image, Pressable, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import CartButton from "@/components/CartButton";
import MenuCard from "@/components/MenuCard";
import ProductTile from "@/components/ProductTile";
import { images, offers } from "@/constants";
import { categoryIcon, firstName, greetingFor, landingRouteFor, pickNewest } from "@/lib/domain/home";
import { getMyRoles } from "@/lib/services/roles";
import { STATUS_META, parseOrderStatus } from "@/lib/domain/orderStatus";
import { formatMoney } from "@/lib/domain/pricing";
import { getActiveOrder, getCategories, getCurrentUser, getMenu } from "@/lib/appwrite";
import { advanceDemo, isDemoAutopilotEnabled, syncPayment } from "@/lib/services/payments.service";
import { listSelectableAddresses, mapProfileRow } from "@/lib/services/profile.service";
import useAuthStore from "@/store/auth.store";
import { Category, MenuItem } from "@/type";

// Una sola redireccion por sesion de la app: asi el usuario con rol puede volver aqui y comprar.
let roleRouted = false;

const SCREEN_W = Dimensions.get("window").width;
const BANNER_W = SCREEN_W - 40;

const SectionTitle = ({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) => (
    <View className="mb-3 mt-6 flex-row items-center justify-between px-5">
        <Text className="h3-bold text-dark-100">{title}</Text>
        {action && (
            <TouchableOpacity onPress={onAction} accessibilityRole="button" accessibilityLabel={action}>
                <Text className="paragraph-bold text-primary">{action}</Text>
            </TouchableOpacity>
        )}
    </View>
);

const Skeleton = ({ className }: { className: string }) => <View className={`rounded-2xl bg-gray-100 ${className}`} />;

/** Pantalla principal del cliente: todo sale de Appwrite (perfil, categorias, productos, pedido activo). */
export default function Index() {
    const user = useAuthStore((s) => s.user);
    const [address, setAddress] = useState<string | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [activeOrder, setActiveOrder] = useState<{ $id: string; status: string; total: number; paymentMethod: string; paymentStatus: string } | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [bannerIndex, setBannerIndex] = useState(0);
    const loadId = useRef(0);

    const load = useCallback(async () => {
        const id = ++loadId.current;
        try {
            setError(null);
            // Catalogo imprescindible: si falla, se muestra error con reintento.
            const [cats, items] = await Promise.all([getCategories(), getMenu({ limit: 40, newest: true })]);
            if (id !== loadId.current) return;
            setCategories(cats);
            setMenu(items);
        } catch {
            if (id === loadId.current) setError("No pudimos cargar el menú. Revisa tu conexión e inténtalo de nuevo.");
        } finally {
            if (id === loadId.current) { setLoading(false); setRefreshing(false); }
        }
        // Datos secundarios: un fallo aqui no tumba la pantalla.
        if (user?.$id) getActiveOrder(user.$id).then((o) => id === loadId.current && setActiveOrder(o)).catch(() => {});
        getCurrentUser()
            .then((row) => {
                const list = listSelectableAddresses(mapProfileRow(row as Record<string, unknown>));
                const selected = mapProfileRow(row as Record<string, unknown>).selectedAddress;
                const chosen = list.find((a) => a.label === selected) ?? list[0];
                if (id === loadId.current) setAddress(chosen?.line ?? null);
            })
            .catch(() => {});
    }, [user?.$id]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (roleRouted) return;
        roleRouted = true;
        getMyRoles().then((r) => {
            const target = landingRouteFor(r);
            if (target) router.push(target as never);
        });
    }, []);
    // Al volver a la pestaña (p. ej. tras pedir o editar el perfil) se refresca el pedido activo y la direccion.
    useFocusEffect(useCallback(() => { if (!loading) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []));

    // Recuperacion de pago: si hay un pedido en linea con pago pendiente (p. ej. se pago en el navegador y se
    // cerro la app), al volver a primer plano se pregunta al servidor, que consulta a Stripe (no se confia en el cliente).
    const activeRef = useRef(activeOrder);
    activeRef.current = activeOrder;
    useEffect(() => {
        const sub = AppState.addEventListener("change", async (state) => {
            const o = activeRef.current;
            if (state !== "active" || !o || o.paymentMethod !== "online" || o.paymentStatus !== "pending") return;
            try {
                const r = await syncPayment(o.$id);
                if (r.paymentStatus !== "pending") load();
            } catch { /* sin conexion: se reintenta la proxima vez */ }
        });
        return () => sub.remove();
    }, [load]);

    // MODO DEMOSTRACION (apagado por omision): mientras hay un pedido activo, el servidor lo avanza solo.
    useEffect(() => {
        if (!isDemoAutopilotEnabled()) return;
        let busy = false;
        const t = setInterval(async () => {
            const o = activeRef.current;
            if (busy || !o) return;
            busy = true;
            try {
                const r = await advanceDemo(o.$id);
                if (r.advanced || r.waiting) load();
            } catch { /* mejor esfuerzo */ } finally { busy = false; }
        }, 5000);
        return () => clearInterval(t);
    }, [load]);

    const newest = useMemo(() => pickNewest(menu, 8), [menu]);
    const grid = useMemo(() => menu.slice(0, 6), [menu]);
    const available = menu.filter((m) => m.available !== false).length;
    const status = activeOrder ? parseOrderStatus(activeOrder.status) : null;
    const meta = status ? STATUS_META[status] : null;

    const goSearch = (params?: Record<string, string>) => router.push({ pathname: "/search", params } as never);

    return (
        <SafeAreaView className="flex-1 bg-white">
            <ScrollView
                contentContainerStyle={{ paddingBottom: 140 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FE8C00" colors={["#FE8C00"]} />}
            >
                {/* Encabezado */}
                <View className="flex-row items-center justify-between px-5 pt-4">
                    <View className="flex-1 pr-3">
                        <Text className="body-regular text-gray-200">
                            {greetingFor(new Date().getHours())}{firstName(user?.name) ? "," : ""}
                        </Text>
                        {!!firstName(user?.name) && <Text className="h3-bold text-dark-100" numberOfLines={1}>{firstName(user?.name)} 👋</Text>}
                        <TouchableOpacity onPress={() => router.push("/edit-profile" as never)} className="mt-1 flex-row items-center" accessibilityRole="button" accessibilityLabel="Cambiar dirección de entrega">
                            <Image source={images.location} className="size-4" resizeMode="contain" tintColor="#FE8C00" />
                            <Text className="small-bold ml-1 flex-shrink text-dark-100" numberOfLines={1}>{address ?? "Agrega tu dirección de entrega"}</Text>
                            <Image source={images.arrowDown} className="ml-1 size-3" resizeMode="contain" />
                        </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => router.push("/orders" as never)} className="mr-3 size-[48px] items-center justify-center rounded-full bg-dark-100" accessibilityRole="button" accessibilityLabel="Mis pedidos">
                        <Ionicons name="receipt-outline" size={22} color="#FFFFFF" />
                    </TouchableOpacity>
                    <CartButton />
                </View>

                {/* Buscador */}
                <View className="mx-5 mt-5 flex-row items-center rounded-full bg-white px-5" style={{ elevation: 5, shadowColor: "#878787" }}>
                    <TextInput
                        className="flex-1 py-4"
                        placeholder="Busca pizzas, hamburguesas…"
                        placeholderTextColor="#A0A0A0"
                        value={query}
                        onChangeText={setQuery}
                        returnKeyType="search"
                        onSubmitEditing={() => goSearch(query.trim() ? { query: query.trim() } : undefined)}
                        accessibilityLabel="Buscar productos"
                    />
                    <TouchableOpacity onPress={() => goSearch(query.trim() ? { query: query.trim() } : undefined)} accessibilityRole="button" accessibilityLabel="Buscar">
                        <Image source={images.search} className="size-6" resizeMode="contain" tintColor="#5D5F6D" />
                    </TouchableOpacity>
                </View>

                {/* Pedido activo */}
                {activeOrder && meta && (
                    <Pressable onPress={() => router.push(`/order/${activeOrder.$id}` as never)} className="mx-5 mt-5 flex-row items-center rounded-2xl p-4" style={{ backgroundColor: meta.background }} accessibilityRole="button" accessibilityLabel="Ver seguimiento de tu pedido">
                        <Ionicons name={meta.icon as never} size={26} color={meta.color} />
                        <View className="ml-3 flex-1">
                            <Text className="base-bold text-dark-100">Tu pedido: {meta.label}</Text>
                            <Text className="text-xs text-gray-200">{formatMoney(activeOrder.total)} · {activeOrder.paymentMethod === "online" && activeOrder.paymentStatus === "pending" ? "Pago pendiente: toca para completarlo" : "Toca para ver el seguimiento"}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={meta.color} />
                    </Pressable>
                )}

                {/* Promociones (banners del restaurante) */}
                <FlatList
                    className="mt-5"
                    data={offers}
                    horizontal
                    pagingEnabled
                    snapToInterval={BANNER_W + 12}
                    decelerationRate="fast"
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 20 }}
                    keyExtractor={(o) => String(o.id)}
                    onMomentumScrollEnd={(e) => setBannerIndex(Math.round(e.nativeEvent.contentOffset.x / (BANNER_W + 12)))}
                    renderItem={({ item }) => (
                        <Pressable onPress={() => goSearch()} style={{ width: BANNER_W, backgroundColor: item.color, marginRight: 12, height: 160 }} className="flex-row overflow-hidden rounded-3xl" android_ripple={{ color: "#ffffff22" }} accessibilityRole="button" accessibilityLabel={`Promoción ${item.title}. Ver menú`}>
                            <View className="flex-1 justify-center pl-5">
                                <Text className="h1-bold leading-tight text-white" numberOfLines={2}>{item.title}</Text>
                                <View className="mt-3 flex-row items-center">
                                    <Text className="paragraph-bold text-white">Ver menú</Text>
                                    <Image source={images.arrowRight} className="ml-2 size-5" resizeMode="contain" tintColor="#ffffff" />
                                </View>
                            </View>
                            <Image source={item.image} style={{ width: "50%", height: "100%" }} resizeMode="contain" />
                        </Pressable>
                    )}
                />
                <View className="mt-3 flex-row justify-center">
                    {offers.map((o, i) => <View key={o.id} className={`mx-1 h-2 rounded-full ${i === bannerIndex ? "w-5 bg-primary" : "w-2 bg-gray-100"}`} />)}
                </View>

                {error ? (
                    <View className="mx-5 mt-8 items-center rounded-2xl bg-red-50 p-6">
                        <Ionicons name="cloud-offline-outline" size={36} color="#EF4444" />
                        <Text className="mt-2 text-center text-sm text-red-500">{error}</Text>
                        <TouchableOpacity onPress={() => { setLoading(true); load(); }} className="mt-4 rounded-full bg-primary px-6 py-3" accessibilityRole="button"><Text className="font-bold text-white">Reintentar</Text></TouchableOpacity>
                    </View>
                ) : loading ? (
                    <View className="mt-8 px-5">
                        <Skeleton className="mb-4 h-8 w-40" />
                        <View className="mb-6 flex-row">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="mr-3 h-20 w-20" />)}</View>
                        <View className="flex-row">{[0, 1].map((i) => <Skeleton key={i} className="mr-4 h-60 w-[220px]" />)}</View>
                        <ActivityIndicator className="mt-6" color="#FE8C00" />
                    </View>
                ) : (
                    <>
                        {/* Categorias */}
                        <SectionTitle title="Categorías" action="Ver todo" onAction={() => goSearch()} />
                        {categories.length === 0 ? (
                            <Text className="px-5 text-gray-200">Aún no hay categorías disponibles.</Text>
                        ) : (
                            <FlatList
                                data={categories}
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ paddingHorizontal: 20 }}
                                keyExtractor={(c) => c.$id}
                                renderItem={({ item }) => (
                                    <TouchableOpacity onPress={() => goSearch({ category: item.$id })} className="mr-3 w-20 items-center" accessibilityRole="button" accessibilityLabel={`Categoría ${item.name}`}>
                                        <View className="h-16 w-16 items-center justify-center rounded-full bg-orange-50">
                                            <Ionicons name={categoryIcon(item.name)} size={28} color="#FE8C00" />
                                        </View>
                                        <Text className="small-bold mt-2 text-center text-dark-100" numberOfLines={1}>{item.name}</Text>
                                    </TouchableOpacity>
                                )}
                            />
                        )}

                        {menu.length === 0 ? (
                            <View className="mx-5 mt-8 items-center rounded-2xl bg-gray-100 p-8">
                                <Ionicons name="restaurant-outline" size={36} color="#9CA3AF" />
                                <Text className="mt-2 text-center text-gray-200">El restaurante aún no ha publicado productos.</Text>
                            </View>
                        ) : (
                            <>
                                {/* Novedades */}
                                <SectionTitle title="Novedades" action="Ver menú" onAction={() => goSearch()} />
                                <FlatList
                                    data={newest}
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                                    keyExtractor={(i) => i.$id}
                                    renderItem={({ item }) => <ProductTile item={item} />}
                                />

                                {/* Menu */}
                                <SectionTitle title={`Nuestro menú · ${available} disponible${available === 1 ? "" : "s"}`} />
                                <View className="flex-row flex-wrap justify-between px-5">
                                    {grid.map((item, i) => (
                                        <View key={item.$id} className={`w-[48%] ${i % 2 === 1 ? "mt-14" : i === 0 ? "mt-10" : "mt-10"}`}>
                                            <MenuCard item={item} />
                                        </View>
                                    ))}
                                </View>
                                {menu.length > grid.length && (
                                    <TouchableOpacity onPress={() => goSearch()} className="mx-5 mt-8 items-center rounded-full border border-primary py-3" accessibilityRole="button">
                                        <Text className="paragraph-bold text-primary">Ver los {menu.length} productos</Text>
                                    </TouchableOpacity>
                                )}
                            </>
                        )}
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}
