'use client';

// =============================================================================
// MetaConnection — the token card and the Top 30 board, shown on /meta/barrido.
//
// The token is pasted by the owner and stored in ad_account (never echoed
// back). The board lists the 30 ads with the most spend in the last 30 days
// and says, per ad, whether the brain already has it, whether the barrido will
// take it, whether the sync still has to fetch it, or whether the file has to
// be uploaded by hand — with the upload right there.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, AlertTriangle, Loader2, Upload, KeyRound, Film, Image as ImageIcon, RefreshCw } from 'lucide-react';
import { createBrowserClient } from '@/lib/supabase-browser';
import { useFormatters } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

interface Check { ok: boolean; name: string | null; granted: string[]; missing: string[]; error: string | null }
interface AccountInfo { account: { id: string; ad_account_id: string; has_token: boolean; token_tail: string | null } | null; check: Check | null }

const PERM_LABEL: Record<string, string> = {
  ads_read: 'ads_read (números de la cuenta)',
  pages_read_engagement: 'pages_read_engagement (descargar videos de la página)',
};

export function MetaTokenCard({ brandId }: { brandId: string | null }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/meta/account?brand=${brandId}`);
      setInfo((await r.json()) as AccountInfo);
    } catch {
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const save = async () => {
    if (!brandId || !token.trim()) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/meta/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brandId, token: token.trim() }) });
      const j = (await r.json()) as { error?: string; check?: Check };
      if (!r.ok) { setMsg({ kind: 'err', text: j.error ?? 'No se pudo guardar' }); return; }
      setToken('');
      setMsg({ kind: 'ok', text: j.check?.ok ? 'Token guardado. Tiene todos los permisos.' : `Token guardado, pero le faltan permisos: ${(j.check?.missing ?? []).join(', ')}` });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const check = info?.check ?? null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><KeyRound className="w-4 h-4 text-ink-3" /> Conexión con Meta</h2>
          <p className="text-xs text-ink-3 mt-0.5">El token con el que la plataforma lee tu cuenta y descarga los creativos. Pégalo aquí; no hay que redesplegar nada.</p>
        </div>
        <button onClick={load} disabled={loading} className="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Probar
        </button>
      </div>

      {info && !info.account && <p className="mt-3 text-xs text-warn">Esta marca no tiene cuenta publicitaria activa en Marcas.</p>}

      {info?.account && (
        <div className="mt-3 text-xs space-y-1">
          <p className="text-ink-2">
            Cuenta <span className="font-[family-name:var(--font-mono)]">{info.account.ad_account_id}</span>
            {info.account.has_token ? <> · token guardado <span className="font-[family-name:var(--font-mono)]">…{info.account.token_tail}</span></> : ' · sin token guardado (usa el de respaldo del servidor)'}
          </p>
          {check && (check.error ? (
            <p className="text-danger inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Meta rechaza el token: {check.error}</p>
          ) : (
            <ul className="space-y-0.5">
              {Object.keys(PERM_LABEL).map((p) => {
                const ok = check.granted.includes(p);
                return (
                  <li key={p} className={`inline-flex items-center gap-1 mr-3 ${ok ? 'text-ok' : 'text-danger'}`}>
                    {ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />} {PERM_LABEL[p]}
                  </li>
                );
              })}
              {check.name && <li className="text-ink-4">Usuario del token: {check.name}</li>}
            </ul>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2 flex-wrap">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Pega aquí el token nuevo (EAA…)"
          autoComplete="off"
          className="flex-1 min-w-[220px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent font-[family-name:var(--font-mono)]"
        />
        <button onClick={save} disabled={saving || !token.trim() || !brandId} className="rounded-md bg-accent text-on-accent text-sm px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar token
        </button>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.kind === 'ok' ? 'text-ok' : 'text-danger'}`}>{msg.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top 30
// ---------------------------------------------------------------------------

type TopState = 'analizado' | 'en_cola' | 'por_descargar' | 'subir';
interface TopItem {
  rank: number; ad_id: string; ad_name: string; meta_id: string | null; kind: 'video' | 'image';
  spend: number; purchases: number; roas: number | null; cpa: number | null;
  thumbnail_url: string | null; has_asset: boolean; manual: boolean; state: TopState; reason: string | null;
}
interface TopResponse { window: { from: string; to: string; days: number; n: number } | null; items: TopItem[]; counts: Record<TopState, number> }

const STATE: Record<TopState, { label: string; cls: string; hint: string }> = {
  analizado: { label: 'Analizado', cls: 'bg-ok-soft text-ok', hint: 'Ya está en el Cerebro.' },
  en_cola: { label: 'En cola', cls: 'bg-accent-soft text-accent', hint: 'El archivo ya está; el barrido lo analiza.' },
  por_descargar: { label: 'Se descarga solo', cls: 'bg-warn-soft text-warn', hint: 'Falta traerlo de Meta con el token (botón "Traer de Meta").' },
  subir: { label: 'Súbelo tú', cls: 'bg-danger-soft text-danger', hint: 'Meta no entrega este archivo. Súbelo aquí y entra a la cola.' },
};

export function MetaTop30({ brandId, currency, refreshKey }: { brandId: string | null; currency: string | null; refreshKey?: number }) {
  const f = useFormatters();
  const [data, setData] = useState<TopResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileFor = useRef<TopItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/meta/top?brand=${brandId}`);
      setData((await r.json()) as TopResponse);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load, refreshKey]);

  const pick = (item: TopItem) => { fileFor.current = item; fileInput.current?.click(); };

  const onFile = async (file: File | null) => {
    const item = fileFor.current;
    if (!file || !item) return;
    setErr(null); setUploading(item.ad_id);
    try {
      let metaId = item.meta_id;
      if (!metaId) throw new Error('Este anuncio aún no existe en la plataforma: primero pulsa "Traer de Meta".');
      const u = await fetch('/api/creatives/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name }) });
      const { path, token, error } = (await u.json()) as { path?: string; token?: string; error?: string };
      if (!path || !token) throw new Error(error ?? 'No se pudo preparar la subida');
      const sb = createBrowserClient();
      const up = await sb.storage.from('creative-videos').uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
      if (up.error) throw new Error(up.error.message);
      const kind = file.type.startsWith('image/') ? 'image' : 'video';
      const p = await fetch(`/api/meta/ads/${metaId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_path: path, asset_kind: kind }) });
      if (!p.ok) throw new Error(((await p.json()) as { error?: string }).error ?? 'No se pudo vincular el archivo');
      metaId = null;
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falló la subida');
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const c = data?.counts;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Top 30 · los que alimentan al Cerebro</h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Siempre los 30 anuncios con más gasto de los últimos 30 días{data?.window ? ` (${data.window.from} – ${data.window.to})` : ''}. Se recalcula en cada sincronización.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Actualizar
        </button>
      </div>

      {c && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(STATE) as TopState[]).map((k) => (
            <span key={k} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${STATE[k].cls}`} title={STATE[k].hint}>
              {STATE[k].label} <span className="font-[family-name:var(--font-mono)]">{c[k]}</span>
            </span>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}

      <input ref={fileInput} type="file" accept="video/*,image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-ink-4 border-b border-line">
              <th className="text-left font-medium py-1.5 pr-2">#</th>
              <th className="text-left font-medium py-1.5 pr-2">Anuncio</th>
              <th className="text-left font-medium py-1.5 pr-2">Tipo</th>
              <th className="text-right font-medium py-1.5 pr-2">Gasto 30d</th>
              <th className="text-right font-medium py-1.5 pr-2">Compras</th>
              <th className="text-right font-medium py-1.5 pr-2">ROAS</th>
              <th className="text-left font-medium py-1.5 pr-2">Estado</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(data?.items ?? []).map((it) => {
              const s = STATE[it.state];
              return (
                <tr key={it.ad_id} className="align-middle">
                  <td className="py-1.5 pr-2 text-ink-4 font-[family-name:var(--font-mono)]">{it.rank}</td>
                  <td className="py-1.5 pr-2 min-w-[200px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-10 rounded bg-inset shrink-0 overflow-hidden flex items-center justify-center text-ink-4">
                        {it.thumbnail_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={it.thumbnail_url} alt="" className="w-full h-full object-cover" />
                          : it.kind === 'video' ? <Film className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
                      </div>
                      <span className="text-ink truncate" title={it.ad_name}>{it.ad_name}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-ink-2">{it.kind === 'video' ? 'Video' : 'Imagen'}</td>
                  <td className="py-1.5 pr-2 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{f.money(it.spend, currency)}</td>
                  <td className="py-1.5 pr-2 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{it.purchases}</td>
                  <td className="py-1.5 pr-2 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{it.roas == null ? '–' : it.roas.toFixed(2)}</td>
                  <td className="py-1.5 pr-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`} title={it.reason ?? s.hint}>{s.label}</span>
                    {it.manual && <span className="ml-1 text-[10px] text-ink-4">subido a mano</span>}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {it.state !== 'analizado' && (
                      <button
                        onClick={() => pick(it)}
                        disabled={uploading === it.ad_id || !it.meta_id}
                        title={!it.meta_id ? 'Primero pulsa "Traer de Meta" para que exista aquí' : 'Subir el archivo de este anuncio'}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] disabled:opacity-40 ${it.state === 'subir' ? 'border-danger text-danger hover:bg-danger-soft' : 'border-line text-ink-2 hover:bg-surface-2'}`}
                      >
                        {uploading === it.ad_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Subir archivo
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {data && data.items.length === 0 && (
              <tr><td colSpan={8} className="py-4 text-center text-ink-4">Sin datos de gasto todavía. Pulsa «Traer de Meta».</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
