#!/usr/bin/env bash
# Copia shared/rules.js dentro de cada funcion como src/rules.js (version ESM).
set -euo pipefail
cd "$(dirname "$0")"
for f in create-order update-order-status; do
  {
    echo "// ARCHIVO GENERADO por sync-shared.sh a partir de shared/rules.js. No editar a mano."
    perl -0pe 's/module\.exports = \{(.*?)\};\s*$/export {$1};\n/s' shared/rules.js
  } > "$f/src/rules.js"
done
echo "rules.js sincronizado en 2 funciones"
