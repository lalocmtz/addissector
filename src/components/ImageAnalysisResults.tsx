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
        <span className="text-[10px] uppercase tracking-wide text-[#64748b]">{label}</span>
        <span className="text-xs font-bold text-[#cbd5e1]">{v}/10</span>
      </div>
      <div className="h-2 rounded-full bg-[#1e1e2e] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]"
          style={{ width: `${v * 10}%` }}
        />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wide text-[#64748b]">{label}</span>
      <p className="text-sm text-[#e2e8f0] mt-0.5">{value || '—'}</p>
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
          <div className="flex gap-1 bg-[#111118] border border-[#1e1e2e] rounded-xl p-1 min-w-min">
            {keys.map((key) => (
              <button
                key={key}
                onClick={() => setActiveKey(key)}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  activeKey === key
                    ? 'bg-[#8b5cf6] text-white shadow-lg shadow-purple-500/20'
                    : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1e1e2e]'
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
          <div className="rounded-2xl overflow-hidden border border-[#1e1e2e] bg-[#0a0a0f]">
            {active.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.previewUrl} alt={activeKey} className="w-full object-contain" />
            ) : (
              <div className="aspect-[4/5] flex items-center justify-center text-[#334155]">
                <Palette className="w-8 h-8" />
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-[#1e1e2e] bg-[#111118] p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Gauge className="w-4 h-4 text-[#8b5cf6]" />
              <h3 className="text-xs font-semibold text-[#f1f5f9] font-[family-name:var(--font-mono)]">Scorecard</h3>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gradient-to-br from-[#2a1a4a] to-[#111118] border border-[#8b5cf6]/30 px-3 py-2">
              <span className="text-xs text-[#e9d5ff]">Score global</span>
              <span className="text-2xl font-bold text-[#f1f5f9]">{Math.max(0, Math.min(10, sc.overall_score || 0))}<span className="text-sm text-[#94a3b8]">/10</span></span>
            </div>
            <ScoreBar value={sc.stopping_power_score} label="Poder de scroll-stop" />
            <ScoreBar value={sc.clarity_score} label="Claridad" />
            <ScoreBar value={sc.offer_strength_score} label="Fuerza de oferta" />
            <ScoreBar value={sc.brand_visibility_score} label="Visibilidad de marca" />
            {sc.scorecard_reasoning && (
              <p className="text-xs text-[#94a3b8] leading-relaxed pt-1 border-t border-[#1e1e2e]">{sc.scorecard_reasoning}</p>
            )}
          </div>
        </div>

        {/* Right: tabs + content */}
        <div className="space-y-6 min-w-0">
          <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-1 flex overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'bg-[#1e1e2e] text-[#f1f5f9] shadow-sm'
                    : 'text-[#64748b] hover:text-[#94a3b8]'
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
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-[#f1f5f9] font-[family-name:var(--font-mono)] mb-1">Composición</h3>
                  <Field label="Formato" value={vb.format} />
                  <Field label="Layout" value={vb.layout} />
                  <Field label="Punto focal" value={vb.focal_point} />
                  {vb.visual_hierarchy?.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Jerarquía visual</span>
                      <ol className="mt-1 space-y-1">
                        {vb.visual_hierarchy.map((h, i) => (
                          <li key={i} className="text-xs text-[#cbd5e1] flex gap-2">
                            <span className="text-[#8b5cf6] font-mono">{i + 1}.</span>{h}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-[#f1f5f9] font-[family-name:var(--font-mono)] mb-1">Estilo y marca</h3>
                  {vb.color_palette?.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Paleta</span>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {vb.color_palette.map((c, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-md border border-white/10" style={{ backgroundColor: c }} />
                            <span className="text-[10px] font-mono text-[#94a3b8]">{c}</span>
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
                      <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Elementos de marca</span>
                      <ul className="mt-1 space-y-1">
                        {vb.branding_elements.map((b, i) => (
                          <li key={i} className="text-xs text-[#cbd5e1]">• {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'copy' && (
              <div className="space-y-4">
                <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-5 space-y-3">
                  <h3 className="text-sm font-semibold text-[#f1f5f9] font-[family-name:var(--font-mono)] mb-1">Copy en la imagen</h3>
                  <div className="rounded-lg bg-[#0d0d14] p-3">
                    <span className="text-[10px] uppercase tracking-wide text-[#a78bfa]">Headline</span>
                    <p className="text-base font-semibold text-[#f1f5f9] mt-0.5">{copy.headline || '—'}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Subheadline" value={copy.subheadline} />
                    <Field label="CTA" value={copy.cta_text} />
                  </div>
                  <Field label="Body" value={copy.body_text} />
                  {copy.offer_badges?.length > 0 && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Badges / oferta</span>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {copy.offer_badges.map((b, i) => (
                          <span key={i} className="text-xs px-2 py-1 rounded-md bg-[#f59e0b]/15 text-[#fbbf24] border border-[#f59e0b]/25 font-medium">{b}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#1e1e2e]">
                    <Field label="Ángulo del copy" value={copy.copy_angle} />
                    <Field label="Framework" value={copy.copy_framework} />
                  </div>
                </div>
                {copy.all_text_verbatim?.length > 0 && (
                  <div className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] uppercase tracking-wide text-[#64748b]">Todo el texto (verbatim)</span>
                      <CopyButton text={copy.all_text_verbatim.join('\n')} label="Copiar texto" />
                    </div>
                    <ul className="space-y-1">
                      {copy.all_text_verbatim.map((t, i) => (
                        <li key={i} className="text-xs text-[#cbd5e1] font-mono">{t}</li>
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
                <div className="rounded-2xl p-5 bg-gradient-to-br from-[#1a2a4a] to-[#111118] border border-[#3b82f6]/30">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-[#dbeafe] font-[family-name:var(--font-mono)]">Recreación fiel</h3>
                    <CopyButton text={rep.faithful_recreation_prompt || ''} label="Copiar prompt" />
                  </div>
                  <p className="text-sm text-[#e2e8f0] leading-relaxed whitespace-pre-wrap">{rep.faithful_recreation_prompt || '—'}</p>
                </div>

                {rep.variants?.map((v) => (
                  <div key={v.variant_number} className="bg-[#111118] border border-[#1e1e2e] rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#8b5cf6]/15 text-[#a78bfa]">Variante {v.variant_number}</span>
                        <span className="text-xs text-[#94a3b8]">{v.angle}</span>
                      </div>
                      <CopyButton text={v.prompt || ''} label="Copiar" />
                    </div>
                    <p className="text-sm text-[#e2e8f0] leading-relaxed whitespace-pre-wrap">{v.prompt || '—'}</p>
                  </div>
                ))}

                {rep.design_notes && (
                  <div className="bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl p-5">
                    <span className="text-[10px] uppercase tracking-wide text-[#f59e0b]">Notas de diseño (no negociables)</span>
                    <p className="text-sm text-[#e2e8f0] mt-1 leading-relaxed">{rep.design_notes}</p>
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
