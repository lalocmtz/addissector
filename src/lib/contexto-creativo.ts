// =============================================================================
// Lo que la cuenta necesita y lo que ya sabemos que funciona. Lo usan:
//   - Lanzar (panel "Qué necesita la cuenta")
//   - el generador de guiones y el adaptador de estáticos (como contexto)
//   - "Tengo una idea" (para decir dónde encaja)
// Todo sale de computeHoy (semáforo) + los lotes + los avatares.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeHoy } from '@/lib/hoy';

export type Puerta = 'iterar' | 'guiones' | 'adaptar' | 'decidir' | 'hoy';

export interface Necesidad {
  id: string;
  prioridad: 1 | 2 | 3;
  titulo: string;
  porque: string;
  puerta: Puerta;
  datos?: Record<string, unknown>;
}

export interface Ganador {
  ad_id: string;
  nombre: string | null;
  luz: string;
  thumbnail_url: string | null;
  kind: string | null;
  roas14: number | null;
  roasIncr14: number | null;
  hook14: number | null;
  gasto14: number;
  cayendo: boolean;
  transcript: string | null;
  veredicto: string | null;
  receta: string | null;
  conservar: string | null;
  probar: string | null;
}

const DIA = 86_400_000;
/** Parte del gasto diario que se reserva para probar lotes nuevos. */
const PARTE_PRUEBA = 0.2;

const corto = (x: unknown, n: number): string | null => {
  if (x == null) return null;
  const t = typeof x === 'string' ? x : JSON.stringify(x);
  const s = t.replace(/\s+/g, ' ').trim();
  return s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null;
};

interface Lote {
  id: string; code: string; name: string; status: string; persona_id: string | null;
  created_at: string; started_at: string | null;
  brief: { kind?: string; origen?: { ad_id?: string | null } | null; trabajo?: string; formato?: string; avatar?: string | null; lote?: string; capa?: string | null; tipo?: string } | null;
}

export async function contextoCreativo(sb: SupabaseClient, brandId: string, userId: string) {
  const hoy = await computeHoy(sb, brandId, userId);
  const [{ data: exps }, { data: personas }] = await Promise.all([
    sb.from('experiment').select('id,code,name,status,persona_id,created_at,started_at,brief')
      .eq('brand_id', brandId).eq('user_id', userId).neq('status', 'archived').order('number', { ascending: false }).limit(120),
    sb.from('personas').select('id,name,callout,description,pains,desires,objections,awareness_stage')
      .eq('brand_id', brandId).is('merged_into', null).order('name'),
  ]);
  const lotes = ((exps ?? []) as Lote[]).filter((e) => e.brief?.kind === '322');
  const ahora = Date.now();

  // --- Ganadores (y sus creativos analizados) ---------------------------------
  const anuncios = ('anuncios' in hoy ? hoy.anuncios : undefined) ?? [];
  const buenos = anuncios.filter((a) => a.luz === 'escalar' || a.luz === 'iterar')
    .sort((a, b) => (b.d14?.spend ?? 0) - (a.d14?.spend ?? 0)).slice(0, 6);
  const ids = buenos.map((a) => a.ad_id);
  const { data: metas } = ids.length
    ? await sb.from('meta_ads').select('ad_id,creative_id,fusion').eq('brand_id', brandId).in('ad_id', ids)
    : { data: [] };
  const cids = (metas ?? []).map((m) => m.creative_id).filter(Boolean) as string[];
  const { data: crs } = cids.length
    ? await sb.from('creatives').select('id,transcript,analysis').in('id', cids)
    : { data: [] };
  const crPor = new Map((crs ?? []).map((c) => [c.id as string, c]));
  const metaPor = new Map((metas ?? []).map((m) => [m.ad_id as string, m]));
  const ganadores: Ganador[] = buenos.map((a) => {
    const m = metaPor.get(a.ad_id);
    const c = m?.creative_id ? crPor.get(m.creative_id as string) : undefined;
    const an = (c?.analysis ?? {}) as Record<string, unknown>;
    return {
      ad_id: a.ad_id, nombre: a.nombre ?? null, luz: a.luz, thumbnail_url: a.thumbnail_url, kind: a.kind,
      roas14: a.d14?.roas ?? null, roasIncr14: a.d14?.roasIncr ?? null, hook14: a.d14?.hook ?? null,
      gasto14: a.d14?.spend ?? 0, cayendo: a.cayendo,
      transcript: corto(c?.transcript ?? an.transcript, 900),
      veredicto: corto(an.verdict ?? m?.fusion, 500),
      receta: corto(an.winning_recipe, 500),
      conservar: corto(an.keep, 300),
      probar: corto(an.test, 300),
    };
  });

  // --- Necesidades -------------------------------------------------------------
  const nec: Necesidad[] = [];
  const conteo = 'conteo' in hoy ? (hoy.conteo as Record<string, number>) : {};
  if ((conteo.apagar ?? 0) > 0) {
    nec.push({ id: 'apagar', prioridad: 1, puerta: 'hoy', titulo: `${conteo.apagar} anuncio(s) para apagar`, porque: 'Ya pasaron el corte de gasto sin cumplir. Se apagan en Hoy antes de lanzar más.' });
  }
  for (const l of lotes) {
    if (l.status !== 'live' || !l.started_at) continue;
    const dias = Math.floor((ahora - new Date(l.started_at).getTime()) / DIA);
    if (dias >= 8) nec.push({ id: `decidir-${l.id}`, prioridad: 1, puerta: 'decidir', titulo: `Decidir ${l.code}`, porque: `Lleva ${dias} días en prueba: ya se puede leer el lote completo. Ganó o perdió, y se libera el lugar.`, datos: { id: l.id, code: l.code } });
  }
  for (const g of ganadores.filter((x) => x.cayendo).slice(0, 2)) {
    nec.push({ id: `cayendo-${g.ad_id}`, prioridad: 1, puerta: 'iterar', titulo: `Reemplazo para ${g.nombre ?? g.ad_id}`, porque: `Era ganador y su ROAS de 7 días ya cae contra el de 14. Itéralo ahora, antes de que deje de vender.`, datos: { ad_id: g.ad_id, nombre: g.nombre } });
  }
  const iterados = new Set(lotes.filter((l) => ahora - new Date(l.created_at).getTime() < 30 * DIA).map((l) => l.brief?.origen?.ad_id).filter(Boolean));
  for (const g of ganadores.filter((x) => !x.cayendo && !iterados.has(x.ad_id)).slice(0, 3)) {
    nec.push({ id: `joya-${g.ad_id}`, prioridad: 2, puerta: 'iterar', titulo: `Iterar ${g.nombre ?? g.ad_id}`, porque: `ROAS 14 d ${g.roas14?.toFixed(2) ?? '—'}${g.roasIncr14 != null ? ` (incremental ${g.roasIncr14.toFixed(2)})` : ''} y sin lote de iteración en 30 días. Un ganador sin iterar es dinero que se queda en la mesa.`, datos: { ad_id: g.ad_id, nombre: g.nombre } });
  }
  // Cuota semanal = cuántos lotes caben en el presupuesto de prueba: cada lote
  // necesita ~1 CPA objetivo al día durante 7 días. 2/3 video, 1/3 estático.
  const eco0 = hoy.economics as { targetCpa?: number | null };
  const cuenta = ('cuenta' in hoy ? hoy.cuenta : undefined) ?? [];
  const gastoDia = (cuenta.find((c) => c.id === 'd7')?.spend ?? 0) / 7;
  const cpa = eco0.targetCpa && eco0.targetCpa > 0 ? eco0.targetCpa : null;
  const capacidad = cpa && gastoDia > 0 ? Math.max(3, Math.min(12, Math.floor((gastoDia * PARTE_PRUEBA) / cpa))) : 3;
  const cuotaVideo = Math.round(capacidad * 2 / 3);
  const cuotaEstatico = capacidad - cuotaVideo;
  const recientes = lotes.filter((l) => ahora - new Date(l.created_at).getTime() < 7 * DIA);
  const semana = recientes.length;
  const semanaVideo = recientes.filter((l) => l.brief?.formato === 'video').length;
  const semanaEstatico = recientes.filter((l) => l.brief?.formato === 'estatico').length;
  const enPrueba = lotes.filter((l) => l.status === 'live' || l.status === 'evaluating').length;
  if (enPrueba > capacidad) {
    nec.push({ id: 'saturado', prioridad: 1, puerta: 'decidir', titulo: `Demasiados lotes en prueba (${enPrueba})`, porque: `El presupuesto de prueba (${Math.round(PARTE_PRUEBA * 100)}% de ~$${Math.round(gastoDia).toLocaleString('es-MX')} al día) alcanza para ~${capacidad} lotes a 1 CPA diario. Con más, ninguno junta datos para decidirse. Decide los más viejos antes de subir nuevos.` });
  }
  if (semanaVideo < cuotaVideo) {
    nec.push({ id: 'cuota-video', prioridad: 2, puerta: 'guiones', titulo: `Faltan ${cuotaVideo - semanaVideo} lote(s) de video esta semana`, porque: `Van ${semanaVideo} de ${cuotaVideo}. El presupuesto de prueba alcanza para ${capacidad} lotes por semana: ${cuotaVideo} de video y ${cuotaEstatico} de estáticos.` });
  }
  if (semanaEstatico < cuotaEstatico) {
    nec.push({ id: 'cuota-estatico', prioridad: 2, puerta: 'adaptar', titulo: `Faltan ${cuotaEstatico - semanaEstatico} lote(s) de estáticos esta semana`, porque: `Van ${semanaEstatico} de ${cuotaEstatico}. Adapta una referencia o itera un estático ganador.` });
  }
  const roles = ('roles' in hoy ? hoy.roles : {}) as Record<string, number>;
  if ((roles.arriba ?? 0) < 0.45 && Object.keys(roles).length) {
    nec.push({ id: 'rol-arriba', prioridad: 2, puerta: 'guiones', titulo: 'Más anuncios de atención (arriba del embudo)', porque: `Solo ${Math.round((roles.arriba ?? 0) * 100)}% del gasto de 14 días va a anuncios con frecuencia de gente nueva (<1.15). Hace falta un lote con trabajo ATENCIÓN.`, datos: { trabajo: 'atencion' } });
  }
  if (((roles.abajo ?? 0) + (roles.retargeting ?? 0)) < 0.12 && Object.keys(roles).length) {
    nec.push({ id: 'rol-abajo', prioridad: 3, puerta: 'guiones', titulo: 'Anuncios de confianza para quien ya te vio', porque: `Abajo + retargeting tienen ${Math.round(((roles.abajo ?? 0) + (roles.retargeting ?? 0)) * 100)}% del gasto. Un lote de CONFIANZA (reseñas, diario de días, respuesta a comentarios) cierra a los que ya conocen.`, datos: { trabajo: 'confianza' } });
  }
  const usados = new Set(lotes.filter((l) => ahora - new Date(l.created_at).getTime() < 30 * DIA).map((l) => l.persona_id).filter(Boolean));
  for (const p of (personas ?? []).filter((x) => !usados.has(x.id)).slice(0, 2)) {
    nec.push({ id: `avatar-${p.id}`, prioridad: 3, puerta: 'guiones', titulo: `Explorar el avatar ${p.name}`, porque: 'Sin lote en 30 días. Explorar avatares nuevos es como se encuentra el siguiente ganador (el 20% de nichos adyacentes).', datos: { personaId: p.id } });
  }
  nec.sort((a, b) => a.prioridad - b.prioridad);

  const pendientes = {
    idea: lotes.filter((l) => l.status === 'planned' || l.status === 'draft').length,
    produccion: lotes.filter((l) => l.status === 'producing').length,
    prueba: lotes.filter((l) => l.status === 'live' || l.status === 'evaluating').length,
    semana,
    cuota: capacidad,
    semanaVideo, cuotaVideo, semanaEstatico, cuotaEstatico,
    gastoDia: Math.round(gastoDia),
  };

  return {
    hoy,
    ganadores,
    personas: personas ?? [],
    lotesRecientes: lotes.slice(0, 15).map((l) => ({ code: l.code, nombre: l.brief?.lote ?? l.name, estado: l.status, trabajo: l.brief?.trabajo ?? null, tipo: l.brief?.tipo ?? null })),
    necesidades: nec,
    pendientes,
  };
}

export type ContextoCreativo = Awaited<ReturnType<typeof contextoCreativo>>;

/** El contexto en texto para los prompts (corto: lo que cambia la decisión). */
export function contextoEnTexto(c: ContextoCreativo, o: { personaId?: string | null } = {}): string {
  const eco = c.hoy.economics as { breakeven: number; target: number; targetCpa?: number | null };
  const ps = o.personaId ? c.personas.filter((p) => p.id === o.personaId) : c.personas.slice(0, 8);
  const L: string[] = [];
  L.push(`ECONOMÍA: equilibrio ROAS ${eco.breakeven} · meta ${eco.target}${eco.targetCpa ? ` · CPA objetivo ${Math.round(eco.targetCpa)} MXN` : ''}.`);
  L.push('\nGANADORES ACTUALES (lo que ya vende; iterar = cambiar UNA capa y conservar el resto):');
  if (!c.ganadores.length) L.push('- Ninguno con juicio todavía.');
  for (const g of c.ganadores) {
    L.push(`- ${g.nombre ?? g.ad_id} [${g.luz}${g.cayendo ? ', CAYENDO' : ''}] ROAS14 ${g.roas14?.toFixed(2) ?? '—'}${g.roasIncr14 != null ? ` incr ${g.roasIncr14.toFixed(2)}` : ''}${g.hook14 != null ? ` hook ${g.hook14.toFixed(0)}%` : ''} · ad_id ${g.ad_id}`);
    if (g.transcript) L.push(`  Transcripción: ${g.transcript}`);
    if (g.veredicto) L.push(`  Veredicto: ${g.veredicto}`);
    if (g.receta) L.push(`  Receta ganadora: ${g.receta}`);
    if (g.conservar) L.push(`  Conservar: ${g.conservar}`);
    if (g.probar) L.push(`  Probar: ${g.probar}`);
  }
  L.push('\nAVATARES:');
  for (const p of ps) {
    L.push(`- ${p.name} (id ${p.id})${p.callout ? ` · "${p.callout}"` : ''}${p.awareness_stage ? ` · conciencia ${p.awareness_stage}` : ''}`);
    const d = [corto(p.pains, 220) && `dolores: ${corto(p.pains, 220)}`, corto(p.desires, 180) && `deseos: ${corto(p.desires, 180)}`, corto(p.objections, 220) && `objeciones: ${corto(p.objections, 220)}`].filter(Boolean);
    if (d.length) L.push(`  ${d.join(' · ')}`);
  }
  L.push('\nLOTES RECIENTES (no repetir):');
  for (const l of c.lotesRecientes) L.push(`- ${l.nombre} [${l.estado}]`);
  L.push('\nLO QUE NECESITA LA CUENTA HOY:');
  for (const n of c.necesidades) L.push(`- (${n.prioridad}) ${n.titulo}: ${n.porque}`);
  return L.join('\n');
}
