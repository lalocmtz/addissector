'use client';

// =============================================================================
// Canvas — panel de chat con el cerebro (abajo del tablero).
// Usa /api/chat con `extra` = volcado compacto del tablero.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, Pin, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

type T = (k: string, v?: Record<string, string | number>) => string;

interface Msg { id: string; role: 'user' | 'assistant'; content: string }

const QUICK = ['hooks', 'angle', 'concepts', 'summary'] as const;

export default function CanvasChat({ brandId, t, buildExtra, onPin, open, onToggle }: {
  brandId: string;
  t: T;
  buildExtra: () => string;
  onPin: (text: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?brand=${brandId}`);
      const json = await res.json();
      if (res.ok) setMessages((json.messages ?? []) as Msg[]);
    } catch { /* silencioso: el historial es opcional */ }
  }, [brandId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true); setError(null); setInput('');
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: message }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, message, extra: buildExtra() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed');
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'assistant', content: json.reply as string }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-line bg-surface flex flex-col shrink-0">
      <button onClick={onToggle} className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-2 hover:text-ink">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="font-medium">{t('canvas.chat.title')}</span>
        <span className="text-ink-4 hidden sm:inline truncate">· {t('canvas.chat.subtitle')}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronUp className="w-3.5 h-3.5 ml-auto" />}
      </button>

      {open && (
        <div className="flex flex-col h-[280px] min-h-0">
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
            {messages.length === 0 && !busy && <p className="text-xs text-ink-4">{t('canvas.chat.empty')}</p>}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] min-w-0 rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink'}`}>
                  {m.content}
                  {m.role === 'assistant' && (
                    <button onClick={() => onPin(m.content)} className="mt-1.5 flex items-center gap-1 text-[11px] text-accent hover:underline">
                      <Pin className="w-3 h-3" />{t('canvas.chat.pin')}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-1.5 text-xs text-ink-3"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t('canvas.chat.thinking')}</div>}
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>

          <div className="px-3 pb-2 pt-1 border-t border-line">
            <div className="flex gap-1.5 overflow-x-auto pb-1.5 -mx-1 px-1">
              {QUICK.map((q) => (
                <button key={q} onClick={() => void send(t(`canvas.chat.quick.${q}`))} disabled={busy}
                  className="shrink-0 px-2 py-0.5 rounded-full border border-line bg-surface text-[11px] text-ink-2 hover:text-ink hover:border-accent disabled:opacity-50">
                  {t(`canvas.chat.quick.${q}`)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-4 mb-1 truncate">{t('canvas.chat.hint')}</p>
            <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="flex items-center gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('canvas.chat.placeholder')} disabled={busy}
                className="flex-1 min-w-0 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent" />
              <button type="submit" disabled={busy || !input.trim()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent text-on-accent text-sm font-medium disabled:opacity-40" title={t('canvas.chat.send')}>
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
