// =============================================================================
// GET /api/brain/digest?brand=&days=7|15|30
//
// Aprendizajes servía una lista larga de frases sueltas: información correcta
// que nadie lee y que no se puede usar. Esta ruta la convierte en lo único que
// sí se usa — UN BLOQUE DE TEXTO PARA PEGAR en el chat que va a escribir el
// siguiente anuncio.
//
// La regla es que todo lo que entra al bloque está sostenido por gasto real del
// periodo: qué ganó, con qué avatar, con qué concepto, con qué hook literal, y
// qué perdió. Nada de adjetivos. Si un periodo no tiene con qué opinar, lo dice
// en vez de rellenar.
//
// Tres ventanas porque responden preguntas distintas: 7 días es qué está
// pasando ahora, 30 es qué es cierto de la cuenta, y 15 es el puente que evita
// confundir una racha con un patrón.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAll } from '@/lib/fetch-all';
import { resolveEconomics, type Economics } from '@/lib/meta';
import { aggregateByAd, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';

export const runtime = 'nodejs';
export const maxDuration = 60;

const VENTANAS = [7, 15, 30] as const;

interface Fila {
  ad_id: string;
  name: string;
  spend: number;
  roas: number | null;
  purchases: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  persona: string | null;
  concepto: string | null;
  hook: string | null;
}

const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(2));
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}%`);
const money = (n: number, cur: string | null) => `${Math.round(n).toLocaleString('es-MX')}${cur ? ` ${cur}` : ''}`;

/** Una línea por anuncio, con todo lo que hace falta para copiar su acierto. */
function linea(f: Fila, cur: string | null): string {
  const partes = [
    `· ${f.name}`,
    `ROAS ${r2(f.roas)}`,
    `gasto ${money(f.spend, cur)}`,
    f.hook_rate != null ? `hook ${pct(f.hook_rate)}` : null,
    f.hold_rate != null ? `retención ${pct(f.hold_rate)}` : null,
    f.persona ? `avatar: ${f.persona}` : null,
    f.concepto ? `concepto: ${f.concepto}` : null,
  ].filter(Boolean);
  const base = partes.join(' · ');
  return f.hook ? `${base}\n    hook: "${f.hook.replace(/\s+/g, ' ').trim().slice(0, 240)}"` : base;
}

/** El bloque completo de una ventana. Markdown plano: se pega en cualquier chat. */
function bloque(opts: {
  marca: string; dias: number; desde: string; hasta: string;
  eco: Economics; cur: string | null;
  ganadores: Fila[]; perdedores: Fila[];
  gasto: number; ingreso: number;
  aprendizajes: string[];
}): string {
  const { marca, dias, desde, hasta, eco, cur, ganadores, perdedores, gasto, ingreso, aprendizajes } = opts;
  const roas = gasto > 0 ? ingreso / gasto : null;
  const L: string[] = [];

  L.push(`# ${marca} — lo que funcionó en ${dias} días (${desde} → ${hasta})`);
  L.push('');
  L.push(`Economía de la marca: equilibrio ROAS ${r2(eco.breakeven)} · objetivo ${r2(eco.target)}.`);
  L.push(`El periodo completo: gasto ${money(gasto, cur)} · ingreso ${money(ingreso, cur)} · ROAS ${r2(roas)}.`);
  L.push('');

  if (!ganadores.length && !perdedores.length) {
    L.push('No hay anuncios con gasto suficiente en esta ventana. No hay nada que copiar todavía.');
    return L.join('\n');
  }

  L.push('## Lo que ganó — copia de aquí');
  if (ganadores.length) {
    L.push(`Anuncios arriba del objetivo (${r2(eco.target)}), del que más gastó al que menos:`);
    L.push('');
    for (const f of ganadores) L.push(linea(f, cur));
  } else {
    L.push(`Ningún anuncio llegó al objetivo ${r2(eco.target)} en esta ventana. Los mejores apenas pagaron el costo.`);
  }
  L.push('');

  if (perdedores.length) {
    L.push('## Lo que perdió — no repitas esto');
    L.push(`Anuncios con gasto real debajo del equilibrio (${r2(eco.breakeven)}):`);
    L.push('');
    for (const f of perdedores) L.push(linea(f, cur));
    L.push('');
  }

  if (aprendizajes.length) {
    L.push('## Aprendizajes registrados en el periodo');
    for (const a of aprendizajes) L.push(`· ${a.replace(/\s+/g, ' ').trim()}`);
    L.push('');
  }

  L.push('## Qué hacer con esto');
  L.push('Escribe los siguientes anuncios tomando los patrones de la sección "Lo que ganó":');
  L.push('el avatar al que le habla, el concepto que usa y la forma del hook literal.');
  L.push('No copies el anuncio entero — copia la razón por la que funcionó y cámbiale la ejecución.');

  return L.join('\n');
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const brandId = sp.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });

  const sb = getSupabase();
  const { data: brand } = await sb.from('brands').select('id,name,economics')
    .eq('id', brandId).eq('user_id', user.id).maybeSingle();
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
  const eco = resolveEconomics(brand.economics);

  const maxDias = Math.max(...VENTANAS);
  const [accountRes, lastRes] = await Promise.all([
    sb.from('ad_account').select('currency').eq('brand_id', brandId).eq('active', true).limit(1).maybeSingle(),
    sb.from('ad_daily').select('date').eq('brand_id', brandId).not('ad_id', 'is', null)
      .order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const cur = (accountRes.data as { currency?: string | null } | null)?.currency ?? null;

  // Anclado en el último día CON DATOS, no en el reloj: con el sync atrasado,
  // "últimos 7 días" contra la pared daría una ventana medio vacía.
  const hasta = (lastRes.data as { date?: string } | null)?.date ?? new Date().toISOString().slice(0, 10);
  const inicio = new Date(`${hasta}T00:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() - (maxDias - 1));
  const desdeMax = inicio.toISOString().slice(0, 10);

  let daily: AdDailyRow[] = [];
  let metaAds: Record<string, unknown>[] = [];
  let personas: { id: string; name: string }[] = [];
  let angles: { id: string; code: string | null; name: string }[] = [];
  let hooks: { title: string | null; body: string | null; ad_ids: string[] | null }[] = [];
  let learnings: { text: string; created_at: string; active: boolean | null }[] = [];
  try {
    [daily, metaAds, personas, angles, hooks, learnings] = await Promise.all([
      fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS)
        .eq('brand_id', brandId).not('ad_id', 'is', null)
        .gte('date', desdeMax).lte('date', hasta).order('date').order('ad_id')) as unknown as Promise<AdDailyRow[]>,
      fetchAll(() => sb.from('meta_ads').select('id,ad_id,name,persona_id,angle_id').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('personas').select('id,name').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('angles').select('id,code,name').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('hook').select('title,body,ad_ids').eq('brand_id', brandId).order('id')),
      fetchAll(() => sb.from('learnings').select('text,created_at,active')
        .eq('brand_id', brandId).gte('created_at', `${desdeMax}T00:00:00Z`).order('created_at', { ascending: false })),
    ]) as [AdDailyRow[], Record<string, unknown>[], { id: string; name: string }[], { id: string; code: string | null; name: string }[], typeof hooks, typeof learnings];
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falló la consulta' }, { status: 500 });
  }

  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const nombrePersona = new Map(personas.map((p) => [p.id, p.name]));
  const nombreAngulo = new Map(angles.map((a) => [a.id, a.code ? `${a.code} · ${a.name}` : a.name]));
  const metaPorAdId = new Map<string, Record<string, unknown>>();
  for (const m of metaAds) { const id = str(m.ad_id); if (id && !metaPorAdId.has(id)) metaPorAdId.set(id, m); }

  // El hook literal, indexado por el uuid de meta_ads que lo corrió.
  const hookPorMetaId = new Map<string, string>();
  for (const h of hooks) {
    const texto = (h.title ?? h.body ?? '').trim();
    if (!texto) continue;
    for (const id of h.ad_ids ?? []) if (!hookPorMetaId.has(id)) hookPorMetaId.set(id, texto);
  }

  const diasAtras = (n: number) => {
    const d = new Date(`${hasta}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (n - 1));
    return d.toISOString().slice(0, 10);
  };

  // Piso de señal: sin esto un anuncio con 12 pesos y una compra entraría de
  // "ganador" y contaminaría el bloque entero.
  const piso = eco.cac ? eco.cac : eco.kill;

  const ventanas = VENTANAS.map((dias) => {
    const desde = diasAtras(dias);
    const filas = aggregateByAd(daily.filter((r) => r.date >= desde && r.date <= hasta));
    const gasto = filas.reduce((s, a) => s + a.spend, 0);
    const ingreso = filas.reduce((s, a) => s + (a.revenue ?? 0), 0);

    const enriquecer = (a: (typeof filas)[number]): Fila => {
      const m = metaPorAdId.get(a.ad_id);
      const metaUuid = m ? str(m.id) : null;
      return {
        ad_id: a.ad_id,
        name: a.ad_name,
        spend: a.spend,
        roas: a.roas,
        purchases: a.purchases,
        hook_rate: a.hook_rate,
        hold_rate: a.hold_rate,
        persona: m && str(m.persona_id) ? nombrePersona.get(str(m.persona_id)!) ?? null : null,
        concepto: m && str(m.angle_id) ? nombreAngulo.get(str(m.angle_id)!) ?? null : null,
        hook: metaUuid ? hookPorMetaId.get(metaUuid) ?? null : null,
      };
    };

    const conSenal = filas.filter((a) => a.spend >= piso);
    const ganadores = conSenal
      .filter((a) => (a.roas ?? 0) >= eco.target)
      .sort((x, y) => y.spend - x.spend).slice(0, 12).map(enriquecer);
    const perdedores = conSenal
      .filter((a) => (a.roas ?? 0) < eco.breakeven)
      .sort((x, y) => y.spend - x.spend).slice(0, 8).map(enriquecer);

    const aprendizajes = learnings
      .filter((l) => l.active !== false && l.created_at.slice(0, 10) >= desde)
      .map((l) => l.text).filter(Boolean).slice(0, 15);

    return {
      dias, desde, hasta,
      gasto, ingreso,
      roas: gasto > 0 ? ingreso / gasto : null,
      ganadores: ganadores.length,
      perdedores: perdedores.length,
      prompt: bloque({
        marca: (brand as { name?: string }).name ?? 'Marca',
        dias, desde, hasta, eco, cur,
        ganadores, perdedores, gasto, ingreso, aprendizajes,
      }),
    };
  });

  return NextResponse.json({ currency: cur, economics: eco, anchor: hasta, ventanas });
}
