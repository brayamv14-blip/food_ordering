#!/usr/bin/env bash
# Pruebas de humo de las dos funciones permitidas.
# Usa un doble en memoria de node-appwrite; NO conecta con Appwrite real.
# Comprueba autorización, idempotencia, compensación, estados,
# asignación de repartidores, entregas y actualización de ubicación.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FN="$HERE/.."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/node_modules"

# Instalar el simulador local de node-appwrite.
cp -r "$HERE/fake-node-appwrite" "$TMP/node_modules/node-appwrite"

# Copiar SOLAMENTE las dos funciones que se desplegarán.
for f in create-order update-order-status; do
    if [[ ! -d "$FN/$f" ]]; then
        echo "ERROR: no existe la carpeta de la función $f"
        exit 1
    fi
    cp -r "$FN/$f" "$TMP/"
done

# Copiar las pruebas y habilitar módulos ES.
cp "$HERE/run.mjs" "$TMP/run.mjs"
echo '{"type":"module"}' > "$TMP/package.json"

# Ejecutar las pruebas.
cd "$TMP"
node run.mjs
