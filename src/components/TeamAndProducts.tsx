'use client';

// =============================================================================
// Team + Products — who executes and what gets tested. Both live on the brand
// screen. A member is a real person (or the AI) with a role; an experiment and
// a variant name their owner by member id. A product is what an experiment
// sells; a brand can have several.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, Users, Package, Check, Pencil } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { MEMBER_ROLES, type MemberRole } from '@/lib/team';

interface Member { id: string; brand_id: string | null; name: string; email: string | null; role: MemberRole; is_ai: boolean; active: boolean }
interface Product { id: string; name: string; description: string | null; price: number | null; url: string | null; active: boolean }

const input = 'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent';
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink hover:border-line-strong disabled:opacity-50';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export function TeamSection({ brandId }: { brandId: string }) {
  const t = useT();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [role, setRole] = useState<MemberRole>('video_editor'); const [scope, setScope] = useState<'brand' | 'all'>('brand');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { items } = await api<{ items: Member[] }>(`/api/members?brand=${brandId}&all=1`); setMembers(items); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setLoading(false); }
  }, [brandId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await api('/api/members', { method: 'POST', body: JSON.stringify({ name, email, role, brandId: scope === 'brand' ? brandId : null }) }); setName(''); setEmail(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };
  const patch = async (m: Member, p: Partial<Member>) => {
    try { await api('/api/members', { method: 'PATCH', body: JSON.stringify({ id: m.id, ...p }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
  };

  const active = members.filter((m) => m.active), inactive = members.filter((m) => !m.active);
  return (
    <section className="mt-8 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-accent" /><h2 className="text-sm font-semibold text-ink">{t('team.title')}</h2></div>
      <p className="text-xs text-ink-3 mb-4">{t('team.help')}</p>
      {error && <p className="text-xs text-danger mb-2">{error}</p>}

      <div className="grid sm:grid-cols-[1fr_1fr_160px_130px_auto] gap-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('team.name')} className={input} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('team.email')} className={input} />
        <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} className={input}>{MEMBER_ROLES.filter((r) => r !== 'ai').map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'brand' | 'all')} className={input}><option value="brand">{t('team.scope.brand')}</option><option value="all">{t('team.scope.all')}</option></select>
        <button onClick={add} disabled={busy || !name.trim()} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}{t('team.add')}</button>
      </div>

      {loading ? <Loader2 className="w-4 h-4 animate-spin text-ink-3" /> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {active.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="w-7 h-7 rounded-full bg-accent-soft text-accent text-xs font-semibold flex items-center justify-center">{m.is_ai ? 'AI' : m.name[0]?.toUpperCase()}</span>
              {editing === m.id ? (
                <input defaultValue={m.name} autoFocus className={`${input} max-w-[220px]`} onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== m.name) patch(m, { name: e.target.value.trim() }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              ) : (
                <button className="text-sm text-ink hover:underline inline-flex items-center gap-1" onClick={() => !m.is_ai && setEditing(m.id)}>{m.name}{!m.is_ai && <Pencil className="w-3 h-3 text-ink-4" />}</button>
              )}
              {m.email && <span className="text-xs text-ink-3">{m.email}</span>}
              <select value={m.role} disabled={m.is_ai} onChange={(e) => patch(m, { role: e.target.value as MemberRole })} className="ml-auto rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2">
                {MEMBER_ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
              </select>
              <span className="text-[11px] text-ink-4">{m.brand_id ? t('team.scope.brand') : t('team.scope.all')}</span>
              {!m.is_ai && <button onClick={() => patch(m, { active: false })} className="text-ink-4 hover:text-danger" title={t('team.remove')}><X className="w-3.5 h-3.5" /></button>}
            </li>
          ))}
          {inactive.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-xs text-ink-4">
              <span className="line-through">{m.name}</span><span>{t(`role.${m.role}`)}</span>
              <button onClick={() => patch(m, { active: true })} className="ml-auto hover:text-ink">{t('team.restore')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProductsSection({ brandId }: { brandId: string }) {
  const t = useT();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { items } = await api<{ items: Product[] }>(`/api/products?brand=${brandId}`); setProducts(items); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setLoading(false); }
  }, [brandId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await api('/api/products', { method: 'POST', body: JSON.stringify({ brandId, name, description, price: price ? Number(price) : null }) }); setName(''); setDescription(''); setPrice(''); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };
  const patch = async (p: Product, body: Partial<Product>) => {
    try { await api('/api/products', { method: 'PATCH', body: JSON.stringify({ id: p.id, ...body }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
  };

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-2 mb-1"><Package className="w-4 h-4 text-accent" /><h2 className="text-sm font-semibold text-ink">{t('products.title')}</h2></div>
      <p className="text-xs text-ink-3 mb-4">{t('products.help')}</p>
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <div className="grid sm:grid-cols-[1fr_2fr_110px_auto] gap-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('products.name')} className={input} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('products.description')} className={input} />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t('products.price')} type="number" className={input} />
        <button onClick={add} disabled={busy || !name.trim()} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}{t('products.add')}</button>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-ink-3" /> : !products.length ? <p className="text-xs text-ink-4">{t('products.empty')}</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {products.map((p) => (
            <li key={p.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${p.active ? '' : 'opacity-50'}`}>
              <span className="text-sm text-ink">{p.name}</span>
              {p.description && <span className="text-xs text-ink-3 truncate max-w-[420px]">{p.description}</span>}
              {p.price != null && <span className="text-xs text-ink-3 font-[family-name:var(--font-mono)]">{p.price}</span>}
              <button onClick={() => patch(p, { active: !p.active })} className={`${btn} ml-auto`}>{p.active ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}{p.active ? t('products.archive') : t('products.restore')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
