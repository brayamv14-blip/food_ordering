# Food Ordering

Aplicación móvil para realizar pedidos de comida. El proyecto permite consultar productos, buscar alimentos, ver detalles, agregar productos al carrito, realizar pedidos y administrar el perfil del usuario.

## Tecnologías

* React Native
* Expo
* TypeScript
* Expo Router
* NativeWind
* Appwrite
* Zustand

## Funcionalidades

* Inicio de sesión y registro de usuarios
* Catálogo de productos
* Búsqueda de productos
* Filtrado por categorías
* Detalle de productos
* Personalización de productos
* Carrito de compras
* Realización de pedidos
* Historial de pedidos
* Perfil de usuario
* Edición del perfil
* Conexión con Appwrite
* Manejo del estado con Zustand

## Requisitos

Antes de ejecutar el proyecto necesitas tener instalado:

* Node.js
* npm
* Git
* Expo Go en el dispositivo móvil

## Instalación

Clona el repositorio:

```bash
git clone https://github.com/brayamv14-blip/food_ordering.git
```

Entra a la carpeta:

```bash
cd food_ordering
```

Instala las dependencias:

```bash
npm install
```

## Variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
EXPO_PUBLIC_APPWRITE_PROJECT_ID=tu_project_id
EXPO_PUBLIC_APPWRITE_ENDPOINT=tu_endpoint
```

Coloca tus propios datos de Appwrite.

> El archivo `.env` no debe subirse al repositorio.

## Ejecutar el proyecto

Inicia Expo con:

```bash
npx expo start
```

Después puedes abrir la aplicación utilizando Expo Go o un emulador compatible.

## Estructura principal

```text
food_ordering/
├── app/
│   ├── (auth)/
│   ├── (tabs)/
│   ├── order/
│   ├── product/
│   ├── checkout.tsx
│   ├── orders.tsx
│   └── edit-profile.tsx
├── components/
├── constants/
├── lib/
├── store/
├── assets/
├── app.json
├── package.json
└── tsconfig.json
```

## Proyecto

Este proyecto fue desarrollado como parte de un proyecto académico para practicar el desarrollo de aplicaciones móviles con React Native, Expo, TypeScript y Appwrite.

## Documentación técnica
- `docs/STRIPE.md` – pagos con Stripe Checkout, webhook, reembolsos, tarjetas de prueba.
- `docs/NOTIFICACIONES.md` – push reales con Firebase + Appwrite Messaging.
- `docs/MAPAS.md` – Geoapify + OpenStreetMap + Leaflet (WebView).
- `docs/APPWRITE.md` – esquema, Functions, variables y permisos.
- `PATCH-LEEME.md` – instalación, configuración y qué falta verificar.
- Expo Go sirve para el flujo de pedidos, pagos (Checkout en el navegador) y mapas; las **notificaciones push remotas en Android requieren una build de desarrollo** (`npx eas-cli build --platform android --profile development`).
