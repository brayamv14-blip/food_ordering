import DeliveryCodeBadge from "@/components/DeliveryCodeBadge";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Share, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import useAuthStore from "@/store/auth.store";
import { useOrderTracking } from "@/hooks/useOrderTracking";
import { cancelMyOrder } from "@/lib/services/orders.service";
import { confirmReceipt, describeBackendError, reportOrderIssue } from "@/lib/services/staff.service";
import ReasonModal from "@/components/ReasonModal";
import RatingForm, { Stars } from "@/components/RatingForm";
import { rateOrder } from "@/lib/services/ratings.service";
import { reorderToCart } from "@/lib/services/reorder.service";
import { getStoreInfo } from "@/lib/services/store.service";
import { estimateEtaMinutes, formatEta } from "@/lib/domain/eta";
import { buildReceipt, receiptText } from "@/lib/domain/receipt";
import { canCustomerCancel, getStatusMeta, isTrackable } from "@/lib/domain/orderStatus";
import { formatMoney } from "@/lib/domain/pricing";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";

const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : null;

const OrderDetail = () => {
    const { id } = useLocalSearchParams<{ id: string }>();
    const user = useAuthStore((s) => s.user);
    const { order, loading, error, stale } = useOrderTracking(id, user?.accountId ?? user?.$id);
    const [cancelling, setCancelling] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [receivedLocal, setReceivedLocal] = useState<string | null>(null);
    const [issueOpen, setIssueOpen] = useState(false);
    const [reporting, setReporting] = useState(false);
    const [reported, setReported] = useState(false);
    const [rating, setRating] = useState<{ rating: number; driverRating: number | null } | null>(null);
    const [ratingBusy, setRatingBusy] = useState(false);
    const [reordering, setReordering] = useState(false);
    const [prepMinutes, setPrepMinutes] = useState<number | null>(null);

    useEffect(() => {
        let alive = true;
        getStoreInfo().then((i) => { if (alive && i) setPrepMinutes(i.prepMinutes); });
        return () => { alive = false; };
    }, []);

    const handleRate = async (v: { rating: number; driverRating: number | null; comment: string }) => {
        if (!order || ratingBusy) return;
        setRatingBusy(true);
        try {
            await rateOrder({ orderId: order.id, rating: v.rating, driverRating: v.driverRating, comment: v.comment });
            setRating({ rating: v.rating, driverRating: v.driverRating });
        } catch (e: any) {
            if (e?.code === "already_rated") setRating({ rating: order.rating ?? v.rating, driverRating: order.driverRating });
            Alert.alert("Calificación", describeBackendError(e));
        } finally {
            setRatingBusy(false);
        }
    };

    const handleReorder = async () => {
        if (!order || reordering) return;
        setReordering(true);
        try {
            const { lines, skipped } = await reorderToCart(order);
            const omitted = skipped.length ? `\n\nNo se agregaron: ${skipped.map((x) => `${x.name} (${x.reason})`).join(", ")}.` : "";
            if (lines.length === 0) {
                Alert.alert("Pedir de nuevo", `No se pudo agregar ningún producto.${omitted}`);
                return;
            }
            Alert.alert("Pedir de nuevo", `Agregamos ${lines.length} producto(s) a tu carrito con los precios actuales.${omitted}`, [
                { text: "Seguir aquí", style: "cancel" },
                { text: "Ir al carrito", onPress: () => router.push("/cart") }
            ]);
        } catch {
            Alert.alert("Pedir de nuevo", "No pudimos consultar el catálogo. Revisa tu conexión e inténtalo de nuevo.");
        } finally {
            setReordering(false);
        }
    };

    const handleShareReceipt = async () => {
        if (!order) return;
        try { await Share.share({ message: receiptText(order, formatMoney) }); } catch { /* el usuario cerro el menu */ }
    };

    const handleCancel = () => {
        if (!order || cancelling) return;
        Alert.alert("Cancelar pedido", order.paymentMethod === "online" && order.paymentStatus === "paid" ? "¿Seguro que quieres cancelar este pedido? Te devolveremos el pago completo a tu tarjeta (puede tardar unos días en reflejarse)." : "¿Seguro que quieres cancelar este pedido?", [
            { text: "No", style: "cancel" },
            {
                text: "Sí, cancelar",
                style: "destructive",
                onPress: async () => {
                    setCancelling(true);
                    try {
                        await cancelMyOrder(order);
                        // El estado nuevo llega por suscripción / consulta periódica.
                    } catch (e: any) {
                        Alert.alert("No se pudo cancelar", e?.message ?? "Inténtalo de nuevo.");
                    } finally {
                        setCancelling(false);
                    }
                }
            }
        ]);
    };

    // La confirmación y el reporte los registra el servidor (el cliente no puede escribir esos campos).
    const handleConfirmReceipt = async () => {
        if (!order || confirming) return;
        setConfirming(true);
        try {
            setReceivedLocal((await confirmReceipt(order.id)) ?? new Date().toISOString());
        } catch (e) {
            Alert.alert("No se pudo confirmar", describeBackendError(e));
        } finally {
            setConfirming(false);
        }
    };

    const handleReport = async (reason: string) => {
        if (!order) return;
        setReporting(true);
        try {
            await reportOrderIssue(order.id, reason);
            setReported(true);
            setIssueOpen(false);
            Alert.alert("Reporte enviado", "El restaurante revisará tu caso.");
        } catch (e) {
            Alert.alert("No se pudo enviar", describeBackendError(e));
        } finally {
            setReporting(false);
        }
    };

    if (loading) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator size="large" color="#FF9C01" />
            </View>
        );
    }

    if (!order) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">{error ?? "No encontramos este pedido."}</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3">
                    <Text className="font-bold text-white">Volver</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const meta = getStatusMeta(order.rawStatus);

    return (
        <SafeAreaView className="flex-1 bg-white">
            <ScrollView contentContainerClassName="px-5 pb-12" showsVerticalScrollIndicator={false}>
                <View className="flex-row items-center pt-3 mb-6">
                    <TouchableOpacity onPress={() => router.back()} className="size-10 rounded-full bg-gray-100 items-center justify-center" accessibilityLabel="Volver">
                        <Ionicons name="arrow-back" size={22} color="#181C2E" />
                    </TouchableOpacity>
                    <Text className="flex-1 text-center h3-bold text-dark-100 mr-10">Pedido #{order.id.slice(-6)}</Text>
                </View>

                {stale && error && (
                    <Text className="small-regular text-red-500 mb-3">{error} Mostrando la última información disponible.</Text>
                )}

                <View className="flex-row items-center justify-between mb-2">
                    <OrderStatusBadge status={order.rawStatus} />
                </View>
                <Text className="small-regular text-gray-200 mb-1">Creado: {fmtDate(order.createdAt) ?? "—"}</Text>
                {order.updatedAt && order.updatedAt !== order.createdAt && (
                    <Text className="small-regular text-gray-200 mb-1">Actualizado: {fmtDate(order.updatedAt)}</Text>
                )}
                {order.status === null && (
                    <Text className="small-regular text-gray-200 mb-1">{meta.description} (valor recibido: “{order.rawStatus || "vacío"}”)</Text>
                )}

                <View className="mt-6">
                    <OrderStatusTimeline status={order.rawStatus} />
                </View>

                {formatEta(estimateEtaMinutes({ status: order.status, prepMinutes })) && (
                    <Text className="mt-4 text-center paragraph-bold text-dark-100" accessibilityLiveRegion="polite">
                        {formatEta(estimateEtaMinutes({ status: order.status, prepMinutes }))} <Text className="small-regular text-gray-200">(estimado)</Text>
                    </Text>
                )}

                <DeliveryCodeBadge orderId={order.id} status={order.status} />

                {isTrackable(order.status) && (
                    <TouchableOpacity
                        onPress={() => router.push({ pathname: "/order/tracking/[id]", params: { id: order.id } })}
                        className="bg-primary rounded-full py-4 mt-2"
                        accessibilityRole="button"
                    >
                        <Text className="text-white text-center paragraph-bold">Seguir mi pedido en el mapa</Text>
                    </TouchableOpacity>
                )}

                <Text className="h3-bold text-dark-100 mt-8 mb-3">Productos</Text>
                <View className="border border-gray-200 rounded-2xl p-5">
                    {order.items.length === 0 && <Text className="text-gray-400">No hay productos registrados.</Text>}
                    {order.items.map((item) => (
                        <View key={item.id} className="mb-4 flex-row justify-between">
                            <View className="flex-1 pr-3">
                                <Text className="base-bold text-dark-100">{item.name}</Text>
                                <Text className="small-regular text-gray-200 mt-1">Cantidad: {item.quantity} · {formatMoney(item.unitPrice)} c/u</Text>
                                {item.extras.length > 0 && (
                                    <Text className="small-regular text-gray-200 mt-1">
                                        Extras: {item.extras.map((e) => `${e.name} (+${formatMoney(e.price)})`).join(", ")}
                                    </Text>
                                )}
                            </View>
                            <Text className="base-bold text-primary">{formatMoney(item.lineTotal)}</Text>
                        </View>
                    ))}
                    <View className="border-t border-gray-200 pt-3">
                        {buildReceipt(order).map((l) => (
                            <View key={l.label} className={`flex-row justify-between ${l.kind === "total" ? "mt-1" : "mb-1"}`}>
                                <Text className={l.kind === "total" ? "base-bold text-dark-100" : "text-gray-200"}>{l.label}</Text>
                                <Text className={l.kind === "total" ? "h3-bold text-primary" : l.kind === "discount" ? "text-green-600" : "text-dark-100"}>
                                    {l.amount < 0 ? "-" : ""}{formatMoney(Math.abs(l.amount))}
                                </Text>
                            </View>
                        ))}
                        <Text className="small-regular text-gray-200 mt-2">
                            Pago: {order.paymentMethod === "online" ? "tarjeta en línea" : "efectivo contra entrega"}
                            {order.paymentStatus === "paid" ? " · pagado" : order.paymentStatus === "refunded" ? " · reembolsado" : ""}
                        </Text>
                        <TouchableOpacity onPress={handleShareReceipt} className="mt-3 self-start" accessibilityRole="button" accessibilityLabel="Compartir recibo">
                            <Text className="paragraph-bold text-primary">Compartir recibo</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <Text className="h3-bold text-dark-100 mt-8 mb-3">Entrega</Text>
                <View className="border border-gray-200 rounded-2xl p-5">
                    <View className="flex-row items-start">
                        <Ionicons name="location-outline" size={22} color="#FE8C00" />
                        <Text className="ml-3 flex-1 paragraph-regular text-dark-100">
                            {order.deliveryAddress?.line ?? "Dirección no registrada en este pedido."}
                        </Text>
                    </View>
                    {order.driverName && (
                        <Text className="small-regular text-gray-200 mt-3">Repartidor: {order.driverName}</Text>
                    )}
                </View>

                {order.status === "delivered" && (
                    <View className="mt-8">
                        {order.receivedAt || receivedLocal ? (
                            <Text className="text-center paragraph-bold text-green-600">Recepción confirmada ✓</Text>
                        ) : (
                            <TouchableOpacity onPress={handleConfirmReceipt} disabled={confirming} className="rounded-full bg-primary py-4" accessibilityRole="button" accessibilityLabel="Confirmar que recibí mi pedido">
                                {confirming ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-center paragraph-bold text-white">Confirmar que recibí mi pedido</Text>}
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {order.status === "delivered" && (
                    <View className="mt-6">
                        {order.rating !== null || rating ? (
                            <View className="items-center">
                                <Text className="paragraph-bold text-dark-100 mb-2">Tu calificación</Text>
                                <Stars value={(rating?.rating ?? order.rating) as number} size={28} label="Tu calificación" />
                            </View>
                        ) : (
                            <RatingForm hasDriver={!!order.driverName} busy={ratingBusy} onSubmit={handleRate} />
                        )}
                    </View>
                )}

                {(order.status === "delivered" || order.status === "cancelled") && order.items.length > 0 && (
                    <TouchableOpacity onPress={handleReorder} disabled={reordering} className="mt-4 rounded-full border border-primary py-4" accessibilityRole="button" accessibilityLabel="Pedir de nuevo">
                        {reordering ? <ActivityIndicator color="#FE8C00" /> : <Text className="text-center paragraph-bold text-primary">Pedir de nuevo</Text>}
                    </TouchableOpacity>
                )}

                {(order.status === "on_the_way" || order.status === "delivered" || order.status === "delivery_failed") && (
                    <TouchableOpacity onPress={() => setIssueOpen(true)} disabled={reported} className="mt-4 rounded-full border border-gray-200 py-4" accessibilityRole="button" accessibilityLabel="Reportar un problema con el pedido">
                        <Text className="text-center paragraph-bold text-dark-100">{reported ? "Problema reportado" : "Reportar un problema"}</Text>
                    </TouchableOpacity>
                )}

                {canCustomerCancel(order.status) && (
                    <TouchableOpacity
                        onPress={handleCancel}
                        disabled={cancelling}
                        className="mt-8 rounded-full border border-red-400 py-4"
                        accessibilityRole="button"
                    >
                        {cancelling ? <ActivityIndicator color="#EF4444" /> : (
                            <Text className="text-center paragraph-bold text-red-500">Cancelar pedido</Text>
                        )}
                    </TouchableOpacity>
                )}
            </ScrollView>
            <ReasonModal
                visible={issueOpen}
                title="¿Qué pasó con tu pedido?"
                options={["No llegó", "Llegó incompleto", "Llegó en mal estado", "Cobro incorrecto"]}
                confirmLabel="Enviar reporte"
                busy={reporting}
                onConfirm={handleReport}
                onClose={() => setIssueOpen(false)}
            />
        </SafeAreaView>
    );
};

export default OrderDetail;
