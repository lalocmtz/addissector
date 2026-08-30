#!/usr/bin/env bash
# =============================================================================
# AdDNA — despliegue de la lectura automática de Meta.
#
#   bash scripts/desplegar.sh
#
# Hace tres cosas: sube la rama, carga las variables de entorno en Vercel
# leyéndolas de .env.local (nunca se escriben a mano) y despliega a producción.
# Es idempotente: correrlo dos veces no rompe nada.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then echo "✗ No encuentro .env.local"; exit 1; fi
set -a; . ./.env.local; set +a

for v in META_ACCESS_TOKEN CRON_SECRET; do
  if [ -z "${!v:-}" ]; then echo "✗ Falta $v en .env.local"; exit 1; fi
done

RAMA=$(git rev-parse --abbrev-ref HEAD)
echo "▸ Subiendo rama $RAMA a GitHub..."
git push -u origin "$RAMA"

echo "▸ Cargando variables en Vercel (production)..."
for v in META_ACCESS_TOKEN CRON_SECRET; do
  vercel env rm "$v" production --yes >/dev/null 2>&1 || true
  printf '%s' "${!v}" | vercel env add "$v" production >/dev/null
  echo "  ✓ $v"
done

echo "▸ Desplegando a producción..."
vercel --prod

cat <<'FIN'

────────────────────────────────────────────────────────────
Listo. Ahora entra a https://addissector.vercel.app/meta/barrido
  1. "Traer de Meta"    -> baja números y descubre creativos
  2. "Iniciar barrido"  -> analiza todo y alimenta el Cerebro

OJO CON EL TOKEN: si lo sacaste del Graph API Explorer caduca en
1-2 horas. Para que esto viva solo, genera un token de Usuario del
Sistema en Business Manager, pégalo en .env.local y vuelve a correr
este script.
────────────────────────────────────────────────────────────
FIN
