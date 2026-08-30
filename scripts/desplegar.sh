#!/usr/bin/env bash
# =============================================================================
# AdDNA — publica la lectura automática de Meta.
#
#   bash ~/addissector/scripts/desplegar.sh
#
# Usa el Vercel que ya vive dentro del proyecto (node_modules), así que no hay
# que instalar nada global. Es idempotente: correrlo dos veces no rompe nada.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

VERCEL="./node_modules/.bin/vercel"
if [ ! -x "$VERCEL" ]; then
  echo "▸ Vercel no está en el proyecto, instalando (una sola vez)..."
  npm install vercel --no-save --silent || { echo "✗ No se pudo instalar"; exit 1; }
fi

if [ ! -f .env.local ]; then echo "✗ No encuentro .env.local"; exit 1; fi
set -a; . ./.env.local; set +a
for v in META_ACCESS_TOKEN CRON_SECRET; do
  if [ -z "${!v:-}" ]; then echo "✗ Falta $v en .env.local"; exit 1; fi
done

echo "▸ Verificando sesión de Vercel..."
if ! "$VERCEL" whoami >/dev/null 2>&1; then
  echo ""
  echo "  Necesitas iniciar sesión en Vercel. Se va a abrir tu navegador."
  echo "  Acepta ahí y regresa a esta ventana."
  echo ""
  "$VERCEL" login || { echo "✗ No se pudo iniciar sesión"; exit 1; }
fi
echo "  ✓ Sesión: $("$VERCEL" whoami 2>/dev/null)"

RAMA=$(git rev-parse --abbrev-ref HEAD)
echo "▸ Subiendo rama $RAMA a GitHub..."
git push -u origin "$RAMA" 2>&1 | tail -2

echo "▸ Cargando variables en Vercel (production)..."
for v in META_ACCESS_TOKEN CRON_SECRET; do
  "$VERCEL" env rm "$v" production --yes >/dev/null 2>&1
  printf '%s' "${!v}" | "$VERCEL" env add "$v" production >/dev/null 2>&1 \
    && echo "  ✓ $v" || echo "  ✗ $v (revísala a mano en Vercel)"
done

echo "▸ Publicando en producción (tarda 1-2 min)..."
"$VERCEL" --prod --yes

cat <<'FIN'

────────────────────────────────────────────────────────────
LISTO. Abre:  https://addissector.vercel.app/meta/barrido

  1. "1 · Traer de Meta"    -> baja numeros y encuentra creativos
  2. "2 · Iniciar barrido"  -> analiza todo solo

Deja la pestana abierta mientras corre.
────────────────────────────────────────────────────────────
FIN
