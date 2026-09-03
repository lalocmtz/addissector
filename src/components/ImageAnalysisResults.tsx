'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Palette, Type, Brain, Wand2, Gauge } from 'lucide-react';
import PsychologicalAnalysis from './PsychologicalAnalysis';
import CopyButton from './CopyButton';
import type { ImageAnalysisResult } from '@/lib/analysis-schema';

interface ImageAnalysisResultsProps {
  results: Map<string, { analysis: ImageAnalysisResult; previewUrl: string | null }>;
}

type TabKey = 'visual' | 'copy' | 'psychology' | 'prompts';

const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'visual', label: 'Visual', icon: <Palette className="w-4 h-4" /> },
  { key: 'copy', label: 'Copy', icon: <Type className="w-4 h-4" /> },
  { key: 'psychology', label: 'Psicologia', icon: <Brain className="w-4 h-4" /> },
  { key: 'prompts', label: 'Prompts', icon: <Wand2 className="w-4 h-4" /> },
];

function ScoreBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(10, value || 0));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-4">{label}</span>
        <span className="text-xs font-bold text-ink-2">{v}/10</span>
      </div>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${v * 10}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-ink-4">{label}</span>
      <p className="text-sm text-ink mt-0.5">{value || '—'}</p>
    </div>
  );
}

export default function ImageAnalysisResults({ results }: ImageAnalysisResultsProps) {
  const keys = useMemo(() => Array.from(results.keys()), [results]);
  const [activeKey, setActiveKey] = useState(keys[0] ?? '');
  const [activeTab, setActiveTab] = useState<TabKey>('visual');

  const active = results.get(activeKey);
  const isMulti = keys.length > 1;
  if (!active) return null;

  const a = active.analysis;
  const vb = a.visual_breakdown;
  const copy = a.copy_analysis;
  const sc = a.dashboard;
  const rep = a.replication;

  return (
    <div className="w-full space-y-6">
      {/* Image tabs (if multiple) */}
      {isMulti && (
        <div className="overflow-x-auto">
          <div className="flex gap-1 bg-surface border border-line rounded-xl p-1 min-w-min">
            {keys.map((key) => (
              <button
                key={key}
                onClick={() => setActiveKey(key)}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  activeKey === key
                    ? 'bg-accent text-on-accent shadow-lg '
                    : 'text-ink-3 hover:text-ink hover:bg-surface-2'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left: preview + scorecard */}
        <div className="space-y-4">
          <div className="rounded-2xl overflow-hidden border border-line bg-canvas">
            {active.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.previewUrl} alt={activeKey} className="w-full object-contain" />
            ) : (
              <div className="aspect-[4/5] flex items-center justify-center text-line-strong">
                <Palette className="w-8 h-8" />
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Gauge className="w-4 h-4 text-accent" />
              <h3 className="text-xs font-semibold text-ink font-[family-name:var(--font-mono)]">Scorecard</h3>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-accent-soft border border-accent/30 px-3 py-2">
              <span className="text-xs text-accent">Score global</span>
              <span className="text-2xl font-bold text-ink">{Math.max(0, Math.min(10, sc.overall_score || 0))}<span className="text-sm text-ink-3">/10</span></span>
            </div>
            <ScoreBar value={sc.stopping_power_score} label="Poder de scroll-stop" />
            <ScoreBar value={sc.clarity_score} label="Claridad" />
            <ScoreBar value={sc.offer_strength_score} label="Fuerza de oferta" />
            <ScoreBar value={sc.brand_visibility_score} label="Visibilidad de marca" />
            {sc.scorecard_reasoning && (
              <p className="text-xs text-ink-3 leading-relaxed pt-1 border-t border-line">{sc.scorecard_reasoning}</p>
            )}
          </div>
        </div>

        {/* Right: tabs + content */}
        <div className="space-y-6 min-w-0">
          <div className="bg-surface border border-line rounded-xl p-1 flex overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'bg-surface-2 text-ink shadow-sm'
                    : 'text-ink-4 hover:text-ink-3'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <motion.div
            key={`${activeTab}-${activeKey}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {activeTab === 'visual' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-ink font-[family-name:var(--font-mono)] mb-1">Composición</h3>
                  <Field label="Formato" value={vb.format} />
                  <Field label="Layout" value={vb.layout} />
                  <Field label="Punto focal" value={vb.focal_point} />
                  {vb.visual_hierarchy?.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-ink-4">Jerarquía visual</span>
                      <ol className="mt-1 space-y-1">
                        {vb.visual_hierarchy.map((h, i) => (
                          <li key={i} className="text-xs text-ink-2 flex gap-2">
                            <span className="text-accent font-mono">{i + 1}.</span>{h}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
                <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-ink font-[family-name:var(--font-mono)] mb-1">Estilo y marca</h3>
                  {vb.color_palette?.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-ink-4">Paleta</span>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {vb.color_palette.map((c, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-md border border-on-accent/10" style={{ backgroundColor: c }} />
                            <span className="text-[10px] font-mono text-ink-3">{c}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <Field label="Psicología del color" value={vb.color_psychology} />
                  <Field label="Tipografía" value={vb.typography} />
                  <Field label="Presentación del producto" value={vb.product_presentation} />
                  <Field label="Estilo de imagen" value={vb.imagery_style} />
                  {vb.branding_elements?.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-ink-4">Elementos de marca</span>
                      <ul className="mt-1 space-y-1">
                        {vb.branding_elements.map((b, i) => (
                          <li key={i} className="text-xs text-ink-2">• {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'copy' && (
              <div className="space-y-4">
                <div className="bg-surface border border-line rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-ink font-[family-name:var(--font-mono)] mb-1">Copy en la imagen</h3>
                  <div className="rounded-lg bg-surface p-3">
                    <span className="text-[10px] uppercase tracking-wide text-accent">Headline</span>
                    <p className="text-base font-semibold text-ink mt-0.5">{copy.headline || '—'}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Subheadline" value={copy.subheadline} />
                    <Field label="CTA" value={copy.cta_text} />
                  </div>
                  <Field label="Body" value={copy.body_text} />
                  {copy.offer_badges?.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-ink-4">Badges / oferta</span>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {copy.offer_badges.map((b, i) => (
                          <span key={i} className="text-xs px-2 py-1 rounded-md bg-warn/15 text-warn border border-warn/25 font-medium">{b}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-line">
                    <Field label="Ángulo del copy" value={copy.copy_angle} />
                    <Field label="Framework" value={copy.copy_framework} />
                  </div>
                </div>
                {copy.all_text_verbatim?.length > 0 && (
                  <div className="bg-surface border border-line rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] uppercase tracking-wide text-ink-4">Todo el texto (verbatim)</span>
                      <CopyButton text={copy.all_text_verbatim.join('\n')} label="Copiar texto" />
                    </div>
                    <ul className="space-y-1">
                      {copy.all_text_verbatim.map((t, i) => (
                        <li key={i} className="text-xs text-ink-2 font-mono">{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'psychology' && (
              <PsychologicalAnalysis data={a.psychological_analysis} />
            )}

            {activeTab === 'prompts' && (
              <div className="space-y-4">
                <div className="rounded-2xl p-5 bg-accent-soft border border-accent/30">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-accent-soft font-[family-name:var(--font-mono)]">Recreación fiel</h3>
                    <CopyButton text={rep.faithful_recreation_prompt || ''} label="Copiar prompt" />
                  </div>
                  <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{rep.faithful_recreation_prompt || '—'}</p>
                </div>

                {rep.variants?.map((v) => (
                  <div key={v.variant_number} className="bg-surface border border-line rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-accent/15 text-accent">Variante {v.variant_number}</span>
                        <span className="text-xs text-ink-3">{v.angle}</span>
                      </div>
                      <CopyButton text={v.prompt || ''} label="Copiar" />
                    </div>
                    <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{v.prompt || '—'}</p>
                  </div>
                ))}

                {rep.design_notes && (
                  <div className="bg-surface border border-line rounded-2xl p-5">
                    <span className="text-[10px] uppercase tracking-wide text-warn">Notas de diseño (no negociables)</span>
                    <p className="text-sm text-ink mt-1 leading-relaxed">{rep.design_notes}</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
