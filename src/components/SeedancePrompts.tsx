'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, ChevronDown, ChevronUp, RefreshCw, Loader2, ImagePlus } from 'lucide-react';
import CopyButton from './CopyButton';
import type { SeedanceSegment } from '@/lib/analysis-schema';

interface SeedancePromptsProps {
  segments: SeedanceSegment[];
  onGenerateMore?: () => Promise<void>;
  isGenerating?: boolean;
}

export default function SeedancePrompts({
  segments,
  onGenerateMore,
  isGenerating = false,
}: SeedancePromptsProps) {
  const [expandedSegments, setExpandedSegments] = useState<Set<number>>(new Set([0]));
  const [referenceImage, setReferenceImage] = useState<string | null>(null);

  const toggleSegment = (index: number) => {
    setExpandedSegments(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReferenceImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const safeSegments = segments ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Reference Image Upload */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ImagePlus className="w-4 h-4 text-[#f59e0b]" />
          <h4 className="text-[#64748b] text-xs uppercase tracking-wider">Imagen de Referencia (Opcional)</h4>
        </div>
        <p className="text-[#94a3b8] text-xs mb-3">
          Sube una foto de la persona que aparecera en el video para incluir su descripcion fisica en los prompts.
        </p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium cursor-pointer
            bg-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#2a2a3e] transition-all border border-[#1e1e2e]">
            <ImagePlus className="w-3.5 h-3.5" />
            {referenceImage ? 'Cambiar imagen' : 'Subir imagen'}
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>
          {referenceImage && (
            <div className="w-12 h-12 rounded-lg overflow-hidden border border-[#1e1e2e]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={referenceImage} alt="Referencia" className="w-full h-full object-cover" />
            </div>
          )}
        </div>
      </div>

      {/* Segments */}
      {safeSegments.map((segment, index) => (
        <div key={index} className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl overflow-hidden">
          {/* Segment Header */}
          <button
            onClick={() => toggleSegment(index)}
            className="w-full px-5 py-3 flex items-center justify-between hover:bg-[#111118] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#3b82f6]/15 flex items-center justify-center">
                <Film className="w-4 h-4 text-[#3b82f6]" />
              </div>
              <div className="text-left">
                <span className="text-[#f1f5f9] text-sm font-semibold">
                  Segmento {segment.segment_number ?? index + 1} de {segment.total_segments ?? safeSegments.length}
                </span>
                <span className="text-[#64748b] text-xs ml-2">
                  {segment.time_start ?? '00:00'} - {segment.time_end ?? '00:15'}
                </span>
              </div>
            </div>
            {expandedSegments.has(index) ? (
              <ChevronUp className="w-4 h-4 text-[#64748b]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#64748b]" />
            )}
          </button>

          <AnimatePresence>
            {expandedSegments.has(index) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 space-y-4">
                  {/* Main Prompt */}
                  <div className="border border-[#1e1e2e] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[#10b981] text-xs font-semibold uppercase tracking-wider">
                        Prompt para Seedance
                      </span>
                      <CopyButton
                        text={segment.prompt ?? ''}
                        label={`Copiar Prompt Segmento ${segment.segment_number ?? index + 1}`}
                      />
                    </div>
                    <div className="text-[#f1f5f9] text-sm leading-relaxed whitespace-pre-wrap seedance-prompt">
                      <SeedanceMarkdown text={segment.prompt ?? ''} />
                    </div>
                  </div>

                  {/* Variants */}
                  {(segment.variants ?? []).length > 0 && (
                    <div className="space-y-3">
                      <span className="text-[#64748b] text-xs uppercase tracking-wider">Variantes</span>
                      {(segment.variants ?? []).map((variant, vi) => (
                        <div key={vi} className="border border-[#1e1e2e]/60 rounded-xl p-4 bg-[#111118]">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[#8b5cf6] text-xs font-semibold">
                              Variante {variant.variant_number ?? vi + 1}
                            </span>
                            <CopyButton
                              text={variant.prompt ?? ''}
                              label={`Copiar Variante ${variant.variant_number ?? vi + 1}`}
                            />
                          </div>
                          <div className="text-[#f1f5f9] text-sm leading-relaxed whitespace-pre-wrap seedance-prompt">
                            <SeedanceMarkdown text={variant.prompt ?? ''} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}

      {/* Generate More */}
      {onGenerateMore && (
        <button
          onClick={onGenerateMore}
          disabled={isGenerating}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
            bg-[#1e1e2e] text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#2a2a3e]
            transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Generar mas variantes de Seedance
        </button>
      )}
    </motion.div>
  );
}

/**
 * Simple markdown renderer for Seedance prompts.
 * Renders headings, bold text, and tables from the rich prompt format.
 */
function SeedanceMarkdown({ text }: { text: string }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const flushTable = () => {
    if (tableRows.length > 0) {
      const header = tableRows[0];
      const body = tableRows.slice(1);
      elements.push(
        <div key={`table-${elements.length}`} className="my-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e2e]">
                {header.map((cell, ci) => (
                  <th key={ci} className="text-left px-3 py-1.5 text-[#64748b] text-xs font-medium">
                    {cell.trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-b border-[#1e1e2e]/30">
                  {row.map((cell, ci) => (
                    <td key={ci} className={`px-3 py-1.5 ${ci === 0 ? 'text-[#3b82f6] font-mono text-xs w-16' : 'text-[#f1f5f9]'}`}>
                      {cell.trim()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table separator row (|---|---|)
    if (/^\|[\s-|]+\|$/.test(line)) {
      continue; // skip separator
    }

    // Table row
    if (line.startsWith('|') && line.endsWith('|')) {
      inTable = true;
      const cells = line.slice(1, -1).split('|');
      tableRows.push(cells);
      continue;
    }

    // If we were in a table but this line isn't a table row, flush
    if (inTable) flushTable();

    // ## Heading
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="text-[#f1f5f9] text-base font-semibold mt-4 mb-2">
          {line.slice(3)}
        </h3>
      );
      continue;
    }

    // ### Heading
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={i} className="text-[#94a3b8] text-sm font-semibold mt-3 mb-1.5 uppercase tracking-wider">
          {line.slice(4)}
        </h4>
      );
      continue;
    }

    // **Bold:** value lines
    if (line.startsWith('**') && line.includes(':**')) {
      const boldEnd = line.indexOf(':**');
      const label = line.slice(2, boldEnd);
      const value = line.slice(boldEnd + 3).trim();
      elements.push(
        <p key={i} className="my-1">
          <span className="text-[#64748b] font-semibold text-xs uppercase">{label}:</span>{' '}
          <span className="text-[#f1f5f9]">{value}</span>
        </p>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
      continue;
    }

    // Regular text
    elements.push(
      <p key={i} className="text-[#f1f5f9] leading-relaxed">
        {renderInlineBold(line)}
      </p>
    );
  }

  // Flush remaining table
  if (inTable) flushTable();

  return <>{elements}</>;
}

/** Renders **bold** inline within a line */
function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-[#f1f5f9]">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
