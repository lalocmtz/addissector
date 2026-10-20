// =============================================================================
// /api/lanzar — la tarjeta 3:2:2. Una tarjeta = una prueba = un conjunto con
// 3 anuncios (una ejecución cada uno), cada anuncio con 2 textos y 2 titulares.
//
// Se guarda sobre las tablas que ya existían: `experiment` (la tarjeta; sus 7
// decisiones viven en `brief` con kind '322') y `experiment_variant` (las 3
// ejecuciones). El código de la tarjeta (ej. FI-007) va en el nombre del
// conjunto y de cada anuncio en Meta: así los resultados se leen solos.
//
//   GET    ?brand=            tarjetas + avatares + ángulos + resultados por código
//   POST   {brandId, ...}     crea la tarjeta y sus 3 ejecuciones
//   PATCH  {id, etapa, ...}   mueve la tarjeta (idea → producción → prueba → decidido)
//   DELETE ?id=               la archiva
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSessionUser } from '@/lib/supabase-server';
import { fetchAll } from '@/lib/fetch-all';
import { sumRows, ratesOf, AD_DAILY_COLUMNS, type AdDailyRow } from '@/lib/metrics';
import { resolveEconomics, targetCpa } from '@/lib/meta';

export const runtime = 'nodejs';
export const maxDuration = 30;

export type Etapa = 'idea' | 'produccion' | 'prueba' | 'decidido';
const ETAPA_A_STATUS: Record<Etapa, string> = { idea: 'planned', produccion: 'producing', prueba: 'live', decidido: 'closed' };
const STATUS_A_ETAPA: Record<string, Etapa> = {
  draft: 'idea', planned: 'idea', producing: 'produccion', live: 'prueba', evaluating: 'prueba', closed: 'decidido',
};

/** Capa de iteración → la variable que declara la prueba (check de la tabla). */
const CAPA_A_VARIABLE: Record<string, string> = {
  mensaje: 'hook', mecanismo: 'concept', avatar: 'persona', educacion: 'angle', oferta: 'offer', visual: 'visual_style',
};

function prefijo(nombre: string): string {
  const partes = nombre.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (partes.length >= 2) return partes.map((p) => p[0]).join('').slice(0, 3);
  return (partes[0] ?? 'AD').slice(0, 2);
}

async function marcaDelUsuario(sb: ReturnType<typeof getSupabase>, brandId: string, userId: string) {
  const { data } = await sb.from('brands').select('id,name,economics').eq('id', brandId).eq('user_id', userId).maybeSingle();
  return data;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const brandId = request.nextUrl.searchParams.get('brand');
  if (!brandId) return NextResponse.json({ error: 'Falta brand' }, { status: 400 });
  const sb = getSupabase();
  const brand = await marcaDelUsuario(sb, brandId, user.id);
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
  const eco = resolveEconomics(brand.economics);

  const [{ data: exps }, { data: personas }, { data: angles }] = await Promise.all([
    sb.from('experiment').select('id,number,code,name,hypothesis,variable,persona_id,status,brief,started_at,closed_at,closed_note,result,created_at')
      .eq('brand_id', brandId).eq('user_id', user.id).neq('status', 'archived').order('number', { ascending: false }),
    sb.from('personas').select('id,name,callout,awareness_stage').eq('brand_id', brandId).is('merged_into', null).order('name'),
    sb.from('angles').select('id,code,name').eq('brand_id', brandId).is('merged_into', null).order('name'),
  ]);
  const tarjetas = (exps ?? []).filter((e) => (e.brief as { kind?: string } | null)?.kind === '322');
  const ids = tarjetas.map((t) => t.id);
  const { data: vars } = ids.length
    ? await sb.from('experiment_variant').select('id,experiment_id,variant,ad_name,hook,script,visual_notes,format,status').in('experiment_id', ids).order('variant')
    : { data: [] };

  // Resultados: los anuncios cuyo nombre en Meta trae el código de la tarjeta.
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const filas = tarjetas.length
    ? (await fetchAll(() => sb.from('ad_daily').select(AD_DAILY_COLUMNS).eq('brand_id', brandId).not('ad_id', 'is', null).gte('date', desde).order('date').order('ad_id'))) as unknown as AdDailyRow[]
    : [];
  const resultados: Record<string, unknown> = {};
  for (const t of tarjetas) {
    const code = String(t.code).toUpperCase();
    const mias = filas.filter((r) => (r.ad_name ?? '').toUpperCase().includes(code));
    if (!mias.length) continue;
    const tot = sumRows(mias);
    const r = ratesOf(tot);
    const dias = new Set(mias.filter((x) => (x.spend ?? 0) > 0).map((x) => x.date));
    const primero = [...dias].sort()[0] ?? null;
    resultados[t.id] = {
      anuncios: new Set(mias.map((x) => x.ad_id)).size,
      spend: tot.spend, purchases: tot.purchases, roas: r.roas, cpa: r.cpa, hook: r.hook_rate,
      diasConGasto: dias.size, primerDia: primero,
    };
  }

  return NextResponse.json({
    economics: { breakeven: eco.breakeven, target: eco.target, targetCpa: targetCpa(eco) },
    prefijo: prefijo(String(brand.name ?? '')),
    tarjetas: tarjetas.map((t) => ({
      ...t,
      etapa: STATUS_A_ETAPA[t.status as string] ?? 'idea',
      ejecuciones: (vars ?? []).filter((v) => v.experiment_id === t.id),
      resultado: resultados[t.id] ?? null,
    })),
    personas: personas ?? [],
    angulos: angles ?? [],
  });
}

interface Ejecucion { hook?: string; guion?: string; visual?: string }

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const brandId = String(b.brandId ?? '');
  const sb = getSupabase();
  const brand = await marcaDelUsuario(sb, brandId, user.id);
  if (!brand) return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });

  const s = (k: string) => String(b[k] ?? '').trim();
  const tipo = s('tipo') === 'iteracion' ? 'iteracion' : 'concepto';
  const concepto = s('concepto');
  const trabajo = s('trabajo');
  const formato = s('formato');
  const capa = s('capa');
  const ejecuciones = (Array.isArray(b.ejecuciones) ? b.ejecuciones : []) as Ejecucion[];
  const textos = (Array.isArray(b.textos) ? b.textos : []).map((x) => String(x ?? '').trim());
  const titulares = (Array.isArray(b.titulares) ? b.titulares : []).map((x) => String(x ?? '').trim());

  const faltan: string[] = [];
  if (!concepto) faltan.push('concepto');
  if (!['atencion', 'valor', 'confianza'].includes(trabajo)) faltan.push('trabajo');
  if (!['video', 'estatico'].includes(formato)) faltan.push('formato (video o estático, uno solo)');
  if (tipo === 'iteracion' && !CAPA_A_VARIABLE[capa]) faltan.push('capa que cambia');
  if (ejecuciones.filter((e) => (e.hook ?? '').trim()).length < 3) faltan.push('3 ejecuciones con su hook');
  if (faltan.length) return NextResponse.json({ error: `Falta: ${faltan.join(', ')}` }, { status: 400 });

  const { data: ultimo } = await sb.from('experiment').select('number').eq('brand_id', brandId).order('number', { ascending: false }).limit(1).maybeSingle();
  const number = ((ultimo?.number as number | undefined) ?? 0) + 1;
  const code = `${prefijo(String(brand.name ?? ''))}-${String(number).padStart(3, '0')}`;
  const now = new Date().toISOString();

  const brief = {
    kind: '322', tipo, capa: tipo === 'iteracion' ? capa : null,
    origen: tipo === 'iteracion' ? { ad_id: s('origenAdId') || null, nombre: s('origenNombre') || null } : null,
    angulo: s('angulo'), trabajo, formato, mensaje: s('mensaje'), objecion: s('objecion'),
    textos: textos.slice(0, 2), titulares: titulares.slice(0, 2),
  };
  const { data: exp, error } = await sb.from('experiment').insert({
    user_id: user.id, brand_id: brandId, number, code, name: concepto,
    hypothesis: s('hipotesis') || null,
    variable: tipo === 'iteracion' ? CAPA_A_VARIABLE[capa] : 'concept',
    persona_id: s('personaId') || null,
    angle_id: s('angleId') || null,
    status: 'planned', brief,
    success_criteria: { kpi: 'cpa', target: targetCpa(resolveEconomics(brand.economics)), days: 7, rule: 'gana si la campaña completa mejora su CPA' },
    created_at: now, updated_at: now,
  }).select('id,code').single();
  if (error || !exp) return NextResponse.json({ error: error?.message ?? 'No se pudo crear' }, { status: 500 });

  const filas = ejecuciones.slice(0, 3).map((e, i) => ({
    user_id: user.id, brand_id: brandId, experiment_id: exp.id,
    ad_name: `${code}-E${i + 1}`, variant: `E${i + 1}`,
    hook: (e.hook ?? '').trim() || null, script: (e.guion ?? '').trim() || null, visual_notes: (e.visual ?? '').trim() || null,
    format: formato, status: 'planned', created_at: now, updated_at: now,
  }));
  const { error: verr } = await sb.from('experiment_variant').insert(filas);
  if (verr) {
    await sb.from('experiment').delete().eq('id', exp.id);
    return NextResponse.json({ error: verr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: exp.id, code: exp.code });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const b = (await request.json().catch(() => ({}))) as { id?: string; etapa?: Etapa; decision?: 'gano' | 'perdio'; nota?: string };
  if (!b.id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const sb = getSupabase();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (b.etapa) {
    if (!ETAPA_A_STATUS[b.etapa]) return NextResponse.json({ error: 'Etapa desconocida' }, { status: 400 });
    patch.status = ETAPA_A_STATUS[b.etapa];
    if (b.etapa === 'prueba') patch.started_at = now;
    if (b.etapa === 'decidido') {
      if (b.decision !== 'gano' && b.decision !== 'perdio') return NextResponse.json({ error: 'Para decidir hay que decir si ganó o perdió' }, { status: 400 });
      patch.closed_at = now;
      patch.result = { decision: b.decision, nota: b.nota ?? null };
      patch.closed_note = b.nota ?? null;
      patch.close_reason = b.decision === 'gano' ? 'validated' : 'refuted';
    }
  }
  const { error } = await sb.from('experiment').update(patch).eq('id', b.id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (b.etapa) {
    const vstatus = b.etapa === 'produccion' ? 'producing' : b.etapa === 'prueba' ? 'live' : b.etapa === 'decidido' ? 'evaluated' : 'planned';
    await sb.from('experiment_variant').update({ status: vstatus, updated_at: now, ...(b.etapa === 'prueba' ? { uploaded_at: now.slice(0, 10) } : {}) })
      .eq('experiment_id', b.id).eq('user_id', user.id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });
  const sb = getSupabase();
  const { error } = await sb.from('experiment').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
