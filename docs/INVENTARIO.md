# Inventario de funcionalidades (estado real)

**Implementado y con pruebas automatizadas (Jest/smoke test con servicios simulados)**
- Registro, inicio/cierre de sesión, recuperación de contraseña, perfil y direcciones (con coordenadas reales vía mapa/GPS).
- Menú, búsqueda, filtros, extras, carrito; el servidor recalcula precios y valida artículos.
- Pedido con idempotencia, historial, detalle, cancelación según etapa (cliente: solo pendiente; pagado → lo cancela el personal con reembolso).
- Cobertura de entrega opcional por radio (servidor).
- Stripe Checkout (sesión por servidor, webhook firmado, `syncPayment`, `payOrder`, reembolsos, pago tardío, idempotencia).
- Push: destino FCM nativo en Appwrite Messaging; eventos de pedido y pago; foreground/tap; token renovado.
- Mapa Leaflet/Geoapify: selección de dirección, seguimiento con ubicación real del repartidor, ruta, marcador del restaurante (opcional).
- Repartidor: entregas activas, compartir ubicación (solo con pedido en camino, primer plano), navegación externa a restaurante/cliente, historial, marcar en camino/entregado.
- Personal: lista/filtros, asignar repartidor, cambiar estado, historial de eventos.

**Incompleto (existe parte, falta algo)**
- Ubicación del repartidor solo en primer plano (no hay seguimiento en segundo plano; requeriría permiso y servicio nativo adicionales).
- Panel de personal: pedidos y asignación sí; **no** hay CRUD de productos/categorías/usuarios, reportes ni historial de pagos en la app (se gestionan en la consola de Appwrite / Stripe Dashboard).

**Ausente (no implementado; requiere cambios de modelo de datos y de máquina de estados)**
- Estados "listo para recoger" y "recogido", aceptar/rechazar asignación, entrega fallida, disponibilidad del repartidor y asignación automática.
- Cupones, múltiples restaurantes, reembolsos parciales, reportes/indicadores.

**Bloqueado por configuración externa (no verificable aquí)**
- Entrega real de push (Firebase + clave de servicio en el proveedor de Appwrite + build de desarrollo + teléfono).
- Cobro de prueba real, webhook registrado en Stripe, `PAYMENT_RETURN_URL` publicada en https.
- Mapa/rutas con la clave de Geoapify en dispositivo.
- Despliegue de las 3 Functions y migración del esquema en tu Appwrite.
