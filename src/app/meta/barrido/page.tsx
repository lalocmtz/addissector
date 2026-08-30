'use client';

// =============================================================================
// /meta/barrido — El barrido automático.
//
// Toma la cola que dejó /api/meta/sync y, por cada anuncio, corre EXACTAMENTE
// el mismo pipeline que el Studio manual (frames -> audio -> transcripción ->
// Claude), pero sin que nadie arrastre archivos: el creativo se baja solo desde
// Meta a través del proxy /api/meta/asset.
//
// Por qué vive en el navegador y no en un worker: la extracción de frames usa
// <video> + canvas y la de audio usa Web Audio API. Reescribirlas con ffmpeg en
// servidor es la fase siguiente; mientras tanto esto ya es automático desde el
// punto de vista del usuario — abrir la pestaña y dejarla corriendo.
//
// Al terminar cada anuncio encadena solo: fusión (video + números) y Cerebro.
// =============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Play, Square, RefreshCw, CheckCircle2, AlertTriangle, Brain, ArrowLeft, Loader2 } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useMe } from '@/lib/use-me';
import { extractFrames, selectFramesForAnalysis } from '@/lib/frame-extractor';
import { extractAudioForTranscription } from '@/lib/audio-extractor';
import { prepareImageForAnalysis } from '@/lib/image-preprocess';
import type { AnalysisResult, ImageAnalysisResult, TranscriptResult } from '@/lib/analysis-schema';

interface QueueItem {
  id: string;
  name: string;
  ad_id: string | null;
  video_id: string | null;
  asset_kind: 'video' | 'image' | 'none';
  asset_strategy: string | null;
  thumbnail_url: string | null;
  duration: number | null;
}

interface Resumen { pendiente: number; listo: number; error: number; omitido: number; sinResolver: number; total: number }

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

type LogKind = 'ok' | 'err' | 'info';
interface LogLine { t: string; kind: LogKind; msg: string }

export default function BarridoPage() {
  const { me, activeBrandId, activeBrand, setActiveBrandId, refresh } = useMe();

  const [corriendo, setCorriendo] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [actual, setActual] = useState<string | null>(null);
  const [paso, setPaso] = useState<string>('');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const detener = useRef(false);

  const apunta = useCallback((kind: LogKind, msg: string) => {
    const t = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((l) => [{ t, kind, msg }, ...l].slice(0, 300));
  }, []);

  const cargarResumen = useCallback(async () => {
    if (!activeBrandId) return;
    try {
      const r = await fetch(`/api/meta/queue?brand=${activeBrandId}&limit=1`);
      if (r.ok) setResumen((await r.json()).resumen);
    } catch { /* silencioso */ }
  }, [activeBrandId]);

  useEffect(() => { cargarResumen(); }, [cargarResumen]);

  // -------------------------------------------------------------------------
  // Paso 1 — traer números y descubrir creativos nuevos
  // -------------------------------------------------------------------------
  const sincronizar = useCallback(async () => {
    if (!activeBrandId) return;
    setSincronizando(true);
    detener.current = false;
    apunta('info', 'Sincronizando con Meta...');

    // Meta limita por RITMO, no por total: con cuentas grandes hay que ir por
    // tandas. Cada vuelta resuelve unas cuantas y guarda; si Meta pide calma,
    // se espera y se retoma donde se quedo.
    let fase: 'todo' | 'creativos' = 'todo';
    let totalResueltos = 0;

    for (let vuelta = 0; vuelta < 60 && !detener.current; vuelta++) {
      let cre: { restantes?: number; limitado?: boolean; resueltos?: number;
                 encolados?: number; omitidos?: number; bloqueados?: number;
                 adsVistos?: number; estrategias?: Record<string, number> } | null = null;
      try {
        const r = await fetch('/api/meta/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId: activeBrandId, phase: fase, days: 90, limiteCreativos: 25 }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Error sincronizando');

        for (const m of j.marcas ?? []) {
          if (m.error) { apunta('err', `${m.marca}: ${m.error}`); continue; }
          if (m.numeros) apunta('ok', `${m.marca}: ${m.numeros.dias ?? 0} días de métricas guardados`);
          cre = m.creativos ?? null;
          if (cre) {
            totalResueltos += cre.resueltos ?? 0;
            apunta('ok', `Creativos: ${cre.encolados ?? 0} listos para analizar · ${cre.omitidos ?? 0} repetidos · ${cre.bloqueados ?? 0} sin video · faltan ${cre.restantes ?? 0}`);
            if (cre.estrategias && Object.keys(cre.estrategias).length) {
              apunta('info', 'Rutas: ' + Object.entries(cre.estrategias).map(([k, v]) => `${k}:${v}`).join(' · '));
            }
          }
        }
      } catch (e) {
        apunta('err', e instanceof Error ? e.message : 'Error sincronizando');
        break;
      }

      fase = 'creativos'; // los números solo hacen falta una vez
      await cargarResumen();

      if (!cre || (cre.restantes ?? 0) === 0) {
        apunta('ok', `Sincronización completa. ${totalResueltos} creativos descubiertos.`);
        break;
      }
      if (cre.limitado) {
        apunta('info', 'Meta pidió calma (límite de peticiones). Esperando 60 s y sigo...');
        await esperar(60000);
      } else {
        await esperar(1500);
      }
    }

    setSincronizando(false);
  }, [activeBrandId, apunta, cargarResumen]);

  // -------------------------------------------------------------------------
  // Paso 2 — analizar un anuncio (mismo pipeline que el Studio)
  // -------------------------------------------------------------------------
  const analizarUno = useCallback(async (item: QueueItem): Promise<void> => {
    setActual(item.name);

    setPaso('Descargando de Meta...');
    const assetRes = await fetch(`/api/meta/asset?ad=${item.id}`);
    if (!assetRes.ok) {
      const j = await assetRes.json().catch(() => ({}));
      throw new Error(j.error || `No se pudo descargar (${assetRes.status})`);
    }
    const blob = await assetRes.blob();
    if (blob.size < 1024) throw new Error('El archivo descargado está vacío');

    const esVideo = item.asset_kind === 'video';
    const ext = esVideo ? 'mp4' : 'jpg';
    const file = new File([blob], `${item.name}.${ext}`, {
      type: blob.type || (esVideo ? 'video/mp4' : 'image/jpeg'),
    });

    let creativeId: string | null = null;

    if (esVideo) {
      setPaso('Extrayendo frames...');
      const { frames, metadata } = await extractFrames(file);
      const selected = selectFramesForAnalysis(frames, 12);

      setPaso('Extrayendo audio...');
      let audio: File = file;
      try { audio = await extractAudioForTranscription(file); } catch { audio = file; }

      setPaso('Transcribiendo...');
      const fd = new FormData();
      fd.append('file', audio);
      const tr = await fetch('/api/transcribe', { method: 'POST', body: fd });
      if (!tr.ok) throw new Error(`Transcripción falló (${tr.status})`);
      const transcript: TranscriptResult = await tr.json();

      setPaso('Analizando con Claude...');
      const ar = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: selected.map((f) => ({ timestamp: f.timestamp, dataUrl: f.dataUrl })),
          transcript,
          videoMeta: {
            duration: metadata.duration, width: metadata.width,
            height: metadata.height, aspectRatio: metadata.aspectRatio,
          },
        }),
      });
      if (!ar.ok) {
        const j = await ar.json().catch(() => ({}));
        const e = new Error(j.error || `Análisis falló (${ar.status})`) as Error & { upgrade?: boolean };
        e.upgrade = ar.status === 402;
        throw e;
      }
      const analysis: AnalysisResult = await ar.json();

      setPaso('Guardando en biblioteca...');
      const preview = selected[Math.floor(selected.length / 2)] ?? selected[0];
      const save = await fetch('/api/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name, type: 'video', brandId: activeBrandId,
          previewDataUrl: preview?.dataUrl ?? null,
          duration: metadata.duration, aspectRatio: metadata.aspectRatio,
          transcript: transcript.transcript, analysis,
          adName: item.name, metaAdId: item.ad_id, metaVideoId: item.video_id,
          source: 'auto',
        }),
      });
      if (save.ok) creativeId = (await save.json()).id ?? null;
    } else {
      setPaso('Preparando imagen...');
      const prep = await prepareImageForAnalysis(file);

      setPaso('Analizando con Claude...');
      const ar = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: prep.dataUrl,
          imageMeta: { width: prep.width, height: prep.height, aspectRatio: prep.aspectRatio },
        }),
      });
      if (!ar.ok) {
        const j = await ar.json().catch(() => ({}));
        const e = new Error(j.error || `Análisis falló (${ar.status})`) as Error & { upgrade?: boolean };
        e.upgrade = ar.status === 402;
        throw e;
      }
      const analysis: ImageAnalysisResult = await ar.json();

      setPaso('Guardando en biblioteca...');
      const save = await fetch('/api/creatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: item.name, type: 'image', brandId: activeBrandId,
          previewDataUrl: prep.previewDataUrl, aspectRatio: prep.aspectRatio, analysis,
          adName: item.name, metaAdId: item.ad_id, metaVideoId: item.video_id,
          source: 'auto',
        }),
      });
      if (save.ok) creativeId = (await save.json()).id ?? null;
    }

    // --- Encadenado automático: fusión + Cerebro -----------------------------
    setPaso('Fusionando con sus números...');
    try {
      await fetch('/api/fusion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: activeBrandId, adName: item.name }),
      });
    } catch { /* la fusión es best-effort */ }

    if (creativeId) {
      setPaso('Alimentando el Cerebro...');
      try {
        await fetch('/api/brain/ingest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandId: activeBrandId, creativeId }),
        });
      } catch { /* el cerebro es best-effort */ }
    }

    await fetch('/api/meta/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: 'listo', creativeId }),
    });
  }, [activeBrandId]);

  // -------------------------------------------------------------------------
  // Paso 3 — el loop
  // -------------------------------------------------------------------------
  const barrer = useCallback(async () => {
    if (!activeBrandId) return;
    detener.current = false;
    setCorriendo(true);
    apunta('info', 'Barrido iniciado. Deja esta pestaña abierta.');

    let hechos = 0;
    while (!detener.current) {
      const r = await fetch(`/api/meta/queue?brand=${activeBrandId}&limit=25`);
      if (!r.ok) { apunta('err', 'No se pudo leer la cola'); break; }
      const { items, resumen: res } = (await r.json()) as { items: QueueItem[]; resumen: Resumen };
      setResumen(res);
      if (items.length === 0) { apunta('ok', `Barrido completo. ${hechos} anuncios procesados en esta sesión.`); break; }

      for (const item of items) {
        if (detener.current) break;
        try {
          await analizarUno(item);
          hechos++;
          apunta('ok', item.name);
        } catch (e) {
          const err = e as Error & { upgrade?: boolean };
          apunta('err', `${item.name} — ${err.message}`);
          await fetch('/api/meta/queue', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, status: 'error', error: err.message.slice(0, 300) }),
          });
          if (err.upgrade) {
            apunta('err', 'Límite del plan alcanzado. El barrido se detiene aquí.');
            detener.current = true;
          }
        }
        await cargarResumen();
      }
      refresh();
    }

    setCorriendo(false);
    setActual(null);
    setPaso('');
  }, [activeBrandId, analizarUno, apunta, cargarResumen, refresh]);

  const pct = resumen && resumen.total > 0
    ? Math.round(((resumen.listo + resumen.omitido) / resumen.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0b1120] text-[#e2e8f0]">
      <AppHeader me={me} activeBrand={activeBrand} onBrandChange={setActiveBrandId} />
      <main className="mx-auto max-w-4xl px-5 py-8">
        <Link href="/meta" className="inline-flex items-center gap-2 text-sm text-[#94a3b8] hover:text-[#e2e8f0]">
          <ArrowLeft className="h-4 w-4" /> Volver a Meta
        </Link>

        <h1 className="mt-4 text-2xl font-semibold text-[#f1f5f9]">Barrido automático</h1>
        <p className="mt-1 text-sm text-[#94a3b8]">
          Lee todos los anuncios de {activeBrand?.name ?? 'la marca'} directo de Meta, los analiza uno por uno
          y alimenta el Cerebro solo. Deja esta pestaña abierta mientras corre.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={sincronizar}
            disabled={sincronizando || corriendo || !activeBrandId}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e293b] px-4 py-2.5 text-sm font-medium hover:bg-[#334155] disabled:opacity-40"
          >
            {sincronizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            1 · Traer de Meta
          </button>
          {!corriendo ? (
            <button
              onClick={barrer}
              disabled={!activeBrandId}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> 2 · Iniciar barrido
            </button>
          ) : (
            <button
              onClick={() => { detener.current = true; apunta('info', 'Deteniendo al terminar el actual...'); }}
              className="inline-flex items-center gap-2 rounded-lg bg-[#7f1d1d] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#991b1b]"
            >
              <Square className="h-4 w-4" /> Detener
            </button>
          )}
        </div>

        {resumen && (
          <div className="mt-6 rounded-xl border border-[#1e293b] bg-[#0f172a] p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-[#94a3b8]">Progreso de la cuenta</span>
              <span className="text-2xl font-semibold text-[#f1f5f9]">{pct}%</span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#1e293b]">
              <div className="h-full rounded-full bg-[#2563eb] transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
              {([
                ['Total', resumen.total, '#e2e8f0'],
                ['Analizados', resumen.listo, '#4ade80'],
                ['Pendientes', resumen.pendiente, '#facc15'],
                ['Con error', resumen.error, '#f87171'],
                ['Sin video', resumen.omitido, '#94a3b8'],
                ['Sin descubrir', resumen.sinResolver, '#a78bfa'],
              ] as const).map(([label, v, color]) => (
                <div key={label}>
                  <div className="text-xs text-[#64748b]">{label}</div>
                  <div className="text-lg font-semibold" style={{ color }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {corriendo && actual && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#1e40af] bg-[#172554] p-4">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#60a5fa]" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[#f1f5f9]">{actual}</div>
              <div className="text-xs text-[#93c5fd]">{paso}</div>
            </div>
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-6">
            <h2 className="flex items-center gap-2 text-sm font-medium text-[#94a3b8]">
              <Brain className="h-4 w-4" /> Bitácora
            </h2>
            <div className="mt-2 max-h-96 overflow-y-auto rounded-xl border border-[#1e293b] bg-[#0f172a] p-3 font-mono text-xs">
              {log.map((l, i) => (
                <div key={i} className="flex gap-2 py-0.5">
                  <span className="shrink-0 text-[#475569]">{l.t}</span>
                  {l.kind === 'ok' && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[#4ade80]" />}
                  {l.kind === 'err' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#f87171]" />}
                  <span className={l.kind === 'err' ? 'text-[#fca5a5]' : l.kind === 'ok' ? 'text-[#cbd5e1]' : 'text-[#94a3b8]'}>
                    {l.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
