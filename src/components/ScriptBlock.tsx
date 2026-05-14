'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import CopyButton from './CopyButton';
import type { ScriptVariant } from '@/lib/analysis-schema';

interface ScriptBlockProps {
  originalScript: string;
  variants: ScriptVariant[];
  onGenerateMore?: () => Promise<void>;
  isGenerating?: boolean;
}

export default function ScriptBlock({
  originalScript,
  variants,
  onGenerateMore,
  isGenerating = false,
}: ScriptBlockProps) {
  const [showVariants, setShowVariants] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Original Script */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#1e1e2e] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#10b981]" />
            <h4 className="text-[#f1f5f9] text-sm font-semibold">Guion Original</h4>
          </div>
          <CopyButton text={originalScript ?? ''} label="Copiar Guion Original" />
        </div>
        <div className="p-5">
          <p className="text-[#f1f5f9] text-sm leading-relaxed whitespace-pre-wrap">
            {originalScript ?? ''}
          </p>
        </div>
      </div>

      {/* Variants Section */}
      <div className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl overflow-hidden">
        <button
          onClick={() => setShowVariants(!showVariants)}
          className="w-full px-5 py-3 border-b border-[#1e1e2e] flex items-center justify-between hover:bg-[#111118] transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#8b5cf6]" />
            <h4 className="text-[#f1f5f9] text-sm font-semibold">
              Variantes del Guion ({(variants ?? []).length})
            </h4>
          </div>
          {showVariants ? <ChevronUp className="w-4 h-4 text-[#64748b]" /> : <ChevronDown className="w-4 h-4 text-[#64748b]" />}
        </button>

        <AnimatePresence>
          {showVariants && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="p-5 space-y-4">
                {(variants ?? []).map((variant, i) => (
                  <div key={i} className="border border-[#1e1e2e] rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#111118] flex items-center justify-between">
                      <div>
                        <span className="text-[#8b5cf6] text-xs font-semibold">Variante {variant.variant_number ?? i + 1}</span>
                        <span className="text-[#64748b] text-xs ml-2">— {variant.scenario ?? ''}</span>
                      </div>
                      <CopyButton text={variant.script ?? ''} label={`Copiar Variante ${variant.variant_number ?? i + 1}`} />
                    </div>
                    <div className="p-4">
                      <p className="text-[#f1f5f9] text-sm leading-relaxed whitespace-pre-wrap">
                        {variant.script ?? ''}
                      </p>
                    </div>
                  </div>
                ))}

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
                    Generar mas variantes
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
