# Fase 0 — Resultados (30 ago 2026)

App: ADNCREATIVE `2116263282644108` · Token usuario con `ads_read` + `ads_management`
Cuenta probada: Feel Ink México `act_1270481044177284`

## ✅ Lo que SÍ funciona

**Insights nivel ad con desglose diario** — reemplaza el CSV del socio hoy mismo:
```
GET /v25.0/act_<id>/insights
  ?level=ad&time_increment=1&date_preset=last_14d
  &fields=ad_id,ad_name,date_start,spend,impressions,frequency,cpm,
          purchase_roas,video_play_actions,video_p75_watched_actions,actions
```
Ventaja sobre el CSV: trae `ad_id` real (mata el matching por nombre),
impresiones REALES (hoy se derivan de spend/cpm) y v3s REALES
(hoy se derivan de hook_rate x impresiones).

**Videoteca de la cuenta** — 904 videos, los 904 con `source` descargable:
```
GET /v25.0/act_<id>/advideos?fields=id,source,length,created_time&limit=200
```
Rango: 2025-03-20 → 2026-08-27. Paginación: 5 páginas.

**Creativos de imagen** — `image_url` del creative funciona sin permisos extra.
29 de 100 ads son imagen → ese 29% se puede automatizar ya.

## ❌ El bloqueo

```
GET /v25.0/<video_id>?fields=source
→ [10] Application does not have permission for this action
```
Falla para TODOS los campos, incluso `id`. No es el campo `source`, es el nodo.

**Y el problema de fondo:** los 64 `video_id` que usan los ads NO están en los
904 de `advideos`. Intersección = 0. Los ads apuntan a videos del
Page `440899179116916` / IG `17841470871262378`. Mismo archivo físico,
namespace de ID distinto.

## Salidas posibles para Fase 2

- **A · Page token** (más limpia): regenerar token con `pages_show_list` +
  `pages_read_engagement` → `GET /me/accounts` → page token → pedir
  `/{video_id}?fields=source` con ESE token. No requiere App Review siendo
  admin de la página.
- **B · Match por contenido** (sin permisos nuevos): bajar los 904 de
  `advideos` y emparejar con los ads por `length` + hash del thumbnail.
- **C · effective_object_story_id** del creative → post de la página → video.
  Misma dependencia de permisos que A.

## Trampa de la API (documentar en el código)

`/act_<id>/ads` con `creative{}` anidado y `limit=200` devuelve `data: []`
**sin error**. Usar `limit<=100` y paginar.
