// =============================================================================
// AdDNA — FASE 0: prueba de viabilidad de la Marketing API.
//
// Responde 4 preguntas, en orden, y se detiene en la primera que falle:
//   1. ¿El token sirve y qué cuentas publicitarias ve?
//   2. ¿Puedo listar los ads con su video_id / imagen?
//   3. ¿El campo `source` del video me da un MP4 descargable?   <-- LA CLAVE
//   4. ¿Insights con time_increment=1 reemplaza el CSV del socio?
//
// Uso:  node scripts/meta-probe.mjs
// Lee META_ACCESS_TOKEN y (opcional) META_AD_ACCOUNT_ID de .env.local
// =============================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V = 'v25.0';
const API = `https://graph.facebook.com/${V}`;

// --- cargar .env.local -------------------------------------------------------
const envPath = resolve(ROOT, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('\n  Falta META_ACCESS_TOKEN en .env.local\n');
  process.exit(1);
}

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const hdr = (s) => `\n\x1b[1m\x1b[36m${s}\x1b[0m`;

async function g(path, params = {}) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', TOKEN);
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) throw new Error(`[${j.error.code}/${j.error.error_subcode ?? '-'}] ${j.error.message}`);
  return j;
}

const results = {};

// --- 1. Token y cuentas ------------------------------------------------------
console.log(hdr('1 · TOKEN Y CUENTAS'));
let actId = process.env.META_AD_ACCOUNT_ID;
try {
  const me = await g('me', { fields: 'id,name' });
  console.log(ok(`Token válido — ${me.name ?? me.id}`));
  const perms = await g('me/permissions');
  const granted = perms.data.filter((p) => p.status === 'granted').map((p) => p.permission);
  for (const need of ['ads_read', 'ads_management']) {
    console.log(granted.includes(need) ? ok(`permiso ${need}`) : bad(`FALTA permiso ${need}`));
  }
  const accts = await g('me/adaccounts', { fields: 'name,account_id,currency,amount_spent', limit: 25 });
  console.log(ok(`${accts.data.length} cuenta(s) publicitaria(s):`));
  for (const a of accts.data) console.log(`    act_${a.account_id}  ${a.name}  (${a.currency})`);
  if (!actId) actId = accts.data[0] && `act_${accts.data[0].account_id}`;
  results.accounts = accts.data.length;
} catch (e) {
  console.log(bad(`Token: ${e.message}`));
  process.exit(1);
}
if (!actId) { console.log(bad('Sin cuenta publicitaria para probar')); process.exit(1); }
console.log(`\n  Usando: \x1b[1m${actId}\x1b[0m`);

// --- 2. Ads + creativos ------------------------------------------------------
console.log(hdr('2 · ADS Y SUS CREATIVOS'));
let ads = [];
try {
  const r = await g(`${actId}/ads`, {
    fields: 'id,name,status,created_time,creative{id,video_id,image_url,thumbnail_url,object_story_spec,asset_feed_spec}',
    limit: 50,
  });
  ads = r.data ?? [];
  console.log(ok(`${ads.length} ads leídos`));

  const videoIds = new Set();
  let conVideo = 0, conImagen = 0, dinamicos = 0;
  for (const a of ads) {
    const c = a.creative ?? {};
    let vid = c.video_id ?? c.object_story_spec?.video_data?.video_id ?? null;
    const feedVids = (c.asset_feed_spec?.videos ?? []).map((v) => v.video_id).filter(Boolean);
    if (feedVids.length > 1) dinamicos++;
    if (!vid && feedVids.length) vid = feedVids[0];
    for (const v of [vid, ...feedVids]) if (v) videoIds.add(v);
    if (vid) conVideo++; else if (c.image_url || c.object_story_spec?.link_data?.image_hash) conImagen++;
  }
  console.log(`    ${conVideo} con video · ${conImagen} con imagen · ${dinamicos} dynamic creative (varios videos)`);
  console.log(ok(`${videoIds.size} video_id únicos  →  dedup ahorra ${conVideo - videoIds.size} análisis`));
  results.videoIds = [...videoIds];
} catch (e) {
  console.log(bad(`Ads: ${e.message}`));
}

// --- 3. LA PRUEBA CLAVE: descargar el MP4 -----------------------------------
console.log(hdr('3 · ¿SE PUEDE BAJAR EL MP4?  ← la pregunta que define todo'));
const muestra = (results.videoIds ?? []).slice(0, 5);
let exitos = 0;
for (const vid of muestra) {
  try {
    const v = await g(vid, { fields: 'id,title,source,picture,length,created_time' });
    if (!v.source) { console.log(bad(`${vid}  sin campo source`)); continue; }
    const head = await fetch(v.source, { method: 'GET', headers: { Range: 'bytes=0-2047' } });
    const buf = Buffer.from(await head.arrayBuffer());
    const esMp4 = buf.includes(Buffer.from('ftyp'));
    const size = head.headers.get('content-range')?.split('/')[1] ?? '?';
    if (head.ok && esMp4) {
      exitos++;
      console.log(ok(`${vid}  MP4 real · ${(Number(size) / 1e6).toFixed(1)} MB · ${v.length ?? '?'}s`));
    } else {
      console.log(bad(`${vid}  source respondió ${head.status} pero no parece MP4`));
    }
  } catch (e) {
    console.log(bad(`${vid}  ${e.message}`));
  }
}
console.log(`\n  \x1b[1m${exitos}/${muestra.length} descargables\x1b[0m`);

// --- 4. Insights diario = reemplazo del CSV ---------------------------------
console.log(hdr('4 · INSIGHTS DIARIO (¿reemplaza el CSV?)'));
try {
  const ins = await g(`${actId}/insights`, {
    level: 'ad',
    time_increment: '1',
    date_preset: 'last_14d',
    fields: [
      'ad_id','ad_name','date_start','spend','impressions','frequency','cpm','cpc',
      'purchase_roas','actions','action_values','video_p25_watched_actions',
      'video_p50_watched_actions','video_p75_watched_actions','video_play_actions',
    ].join(','),
    limit: 5,
  });
  const row = ins.data?.[0];
  if (!row) { console.log(bad('Sin filas (¿la cuenta gastó en los últimos 14 días?)')); }
  else {
    console.log(ok('Insights responde con desglose por día. Fila de ejemplo:'));
    console.log(`    ad_id      ${row.ad_id}   <-- esto MATA el matching por nombre`);
    console.log(`    fecha      ${row.date_start}`);
    console.log(`    spend      ${row.spend}`);
    console.log(`    impresiones ${row.impressions}  (reales, ya no derivadas de spend/cpm)`);
    console.log(`    roas       ${row.purchase_roas?.[0]?.value ?? 'N/D'}`);
    console.log(`    v3s        ${row.video_play_actions?.[0]?.value ?? 'N/D'}  (real, ya no hook%×impresiones)`);
    console.log(`    v75        ${row.video_p75_watched_actions?.[0]?.value ?? 'N/D'}`);
    writeFileSync(resolve(ROOT, 'scripts/meta-probe-sample.json'), JSON.stringify(ins.data, null, 2));
    console.log(ok('Muestra guardada en scripts/meta-probe-sample.json'));
  }
} catch (e) {
  console.log(bad(`Insights: ${e.message}`));
}

// --- Veredicto ---------------------------------------------------------------
console.log(hdr('VEREDICTO'));
if (exitos === muestra.length && muestra.length > 0) {
  console.log('  Plan completo VIABLE. Fases 1→4 sin plan B.');
} else if (exitos > 0) {
  console.log('  Viable PARCIAL: algunos videos no bajan. Hay que ver el patrón antes de la Fase 2.');
} else {
  console.log('  El MP4 no baja por `source`. La Fase 1 (matar el CSV) sigue viable;');
  console.log('  la Fase 2 necesita plan B (ad preview / permalink / Ad Library).');
}
console.log('');
