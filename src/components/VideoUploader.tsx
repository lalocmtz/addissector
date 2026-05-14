'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, FileVideo, AlertCircle, Link as LinkIcon } from 'lucide-react';

interface VideoUploaderProps {
  onAnalyze: (files: File[]) => void;
  isProcessing: boolean;
  progress: Map<string, { stage: string; percent: number }>;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_FILES = 5;

const stageLabels: Record<string, string> = {
  idle: 'Listo',
  extracting_frames: 'Extrayendo frames...',
  transcribing: 'Transcribiendo audio...',
  analyzing: 'Analizando con IA...',
  complete: 'Completado',
  error: 'Error',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VideoUploader({ onAnalyze, isProcessing, progress }: VideoUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [urlText, setUrlText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const newErrors: string[] = [];
    const validFiles: File[] = [];

    for (const file of fileArray) {
      if (!file.type.startsWith('video/mp4') && !file.name.endsWith('.mp4')) {
        newErrors.push(`"${file.name}" no es un archivo MP4`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        newErrors.push(`"${file.name}" excede el limite de 100MB`);
        continue;
      }
      if (files.length + validFiles.length >= MAX_FILES) {
        newErrors.push(`Maximo ${MAX_FILES} archivos permitidos`);
        break;
      }
      const alreadyAdded = files.some((f) => f.name === file.name && f.size === file.size);
      if (alreadyAdded) {
        newErrors.push(`"${file.name}" ya fue agregado`);
        continue;
      }
      validFiles.push(file);
    }

    setErrors(newErrors);
    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles]);
    }
  }, [files]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setErrors([]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  }, [validateAndAddFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAddFiles(e.target.files);
      e.target.value = '';
    }
  }, [validateAndAddFiles]);

  const getProgressColor = (stage: string) => {
    switch (stage) {
      case 'complete': return 'from-emerald-500 to-emerald-400';
      case 'error': return 'from-rose-500 to-rose-400';
      default: return 'from-blue-500 to-cyan-400';
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Drop Zone */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-xl border-2 border-dashed p-8
          transition-all duration-300 flex flex-col items-center justify-center gap-4
          ${isDragging
            ? 'border-blue-500 bg-blue-500/10 scale-[1.02]'
            : 'border-[#1e1e2e] bg-[#111118] hover:border-[#3b82f6]/50 hover:bg-[#111118]/80'
          }
          ${isProcessing ? 'pointer-events-none opacity-60' : ''}
        `}
      >
        <motion.div
          animate={isDragging ? { scale: 1.2, rotate: 5 } : { scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300 }}
        >
          <Upload className="w-12 h-12 text-[#3b82f6]" />
        </motion.div>
        <div className="text-center">
          <p className="text-[#f1f5f9] text-lg font-medium">
            Arrastra y suelta videos MP4 aqui
          </p>
          <p className="text-[#94a3b8] text-sm mt-1">
            o haz clic para seleccionar archivos
          </p>
          <p className="text-[#64748b] text-xs mt-2">
            Maximo {MAX_FILES} archivos, 100MB cada uno
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,.mp4"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </motion.div>

      {/* Errors */}
      <AnimatePresence>
        {errors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-1"
          >
            {errors.map((error, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-[#f43f5e]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* File List */}
      <AnimatePresence mode="popLayout">
        {files.map((file, index) => {
          const fileProgress = progress.get(file.name);
          const stage = fileProgress?.stage ?? 'idle';
          const percent = fileProgress?.percent ?? 0;

          return (
            <motion.div
              key={`${file.name}-${file.size}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 min-w-0">
                  <FileVideo className="w-5 h-5 text-[#3b82f6] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[#f1f5f9] text-sm font-medium truncate">
                      {file.name}
                    </p>
                    <p className="text-[#64748b] text-xs">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono ${
                    stage === 'complete' ? 'text-[#10b981]' :
                    stage === 'error' ? 'text-[#f43f5e]' :
                    'text-[#94a3b8]'
                  }`}>
                    {stageLabels[stage] ?? stage}
                  </span>
                  {!isProcessing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                      className="text-[#64748b] hover:text-[#f43f5e] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {stage !== 'idle' && stage !== 'complete' && stage !== 'error' && (
                <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full bg-gradient-to-r ${getProgressColor(stage)}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  >
                    <div className="w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
                  </motion.div>
                </div>
              )}

              {stage === 'complete' && (
                <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" />
                </div>
              )}

              {stage === 'error' && (
                <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                  <div className="h-full w-full rounded-full bg-gradient-to-r from-rose-500 to-rose-400" />
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* URL Input */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[#94a3b8] text-sm">
          <LinkIcon className="w-4 h-4" />
          <span>URLs de referencia (opcional)</span>
        </div>
        <textarea
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder="Pega URLs de TikTok, Instagram, Facebook..."
          disabled={isProcessing}
          rows={3}
          className="w-full bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 text-[#f1f5f9] text-sm
            placeholder:text-[#64748b] resize-none focus:outline-none focus:border-[#3b82f6]/50
            transition-colors disabled:opacity-50"
        />
        <div className="flex items-center gap-2 text-[#64748b] text-xs">
          <AlertCircle className="w-3 h-3" />
          <span>Para URLs, descarga el video primero y subelo como MP4</span>
        </div>
      </div>

      {/* Analyze Button */}
      <motion.button
        whileHover={files.length > 0 && !isProcessing ? { scale: 1.02 } : {}}
        whileTap={files.length > 0 && !isProcessing ? { scale: 0.98 } : {}}
        onClick={() => files.length > 0 && !isProcessing && onAnalyze(files)}
        disabled={files.length === 0 || isProcessing}
        className={`
          w-full py-4 px-8 rounded-xl text-lg font-semibold transition-all duration-300
          ${files.length > 0 && !isProcessing
            ? 'bg-gradient-to-r from-[#3b82f6] to-[#2563eb] text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40'
            : 'bg-[#1e1e2e] text-[#64748b] cursor-not-allowed'
          }
        `}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center gap-3">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
            />
            Diseccionando...
          </span>
        ) : (
          `Diseccionar ${files.length > 0 ? `(${files.length} video${files.length > 1 ? 's' : ''})` : ''}`
        )}
      </motion.button>
    </div>
  );
}
