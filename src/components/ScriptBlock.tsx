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
      <div className="bg-canvas border border-line rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-ok" />
            <h4 className="text-ink text-sm font-semibold">Guion Original</h4>
          </div>
          <CopyButton text={originalScript ?? ''} label="Copiar Guion Original" />
        </div>
        <div className="p-5">
          <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">
            {originalScript ?? ''}
          </p>
        </div>
      </div>

      {/* Variants Section */}
      <div className="bg-canvas border border-line rounded-xl overflow-hidden">
        <button
          onClick={() => setShowVariants(!showVariants)}
          className="w-full px-5 py-3 border-b border-line flex items-center justify-between hover:bg-surface transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" />
            <h4 className="text-ink text-sm font-semibold">
              Variantes del Guion ({(variants ?? []).length})
            </h4>
          </div>
          {showVariants ? <ChevronUp className="w-4 h-4 text-ink-4" /> : <ChevronDown className="w-4 h-4 text-ink-4" />}
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
                  <div key={i} className="border border-line rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-surface flex items-center justify-between">
                      <div>
                        <span className="text-accent text-xs font-semibold">Variante {variant.variant_number ?? i + 1}</span>
                        <span className="text-ink-4 text-xs ml-2">— {variant.scenario ?? ''}</span>
                      </div>
                      <CopyButton text={variant.script ?? ''} label={`Copiar Variante ${variant.variant_number ?? i + 1}`} />
                    </div>
                    <div className="p-4">
                      <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">
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
                      bg-surface-2 text-ink-3 hover:text-ink hover:bg-surface-2
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
