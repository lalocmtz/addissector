'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, ImageIcon, AlertCircle } from 'lucide-react';

interface ImageUploaderProps {
  onAnalyze: (files: File[]) => void;
  isProcessing: boolean;
  progress: Map<string, { stage: string; percent: number }>;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (downscaled client-side anyway)
const MAX_FILES = 5;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageUploader({ onAnalyze, isProcessing, progress }: ImageUploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateAndAddFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const newErrors: string[] = [];
    const validFiles: File[] = [];

    for (const file of fileArray) {
      const isImage = ACCEPTED.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
      if (!isImage) {
        newErrors.push(`"${file.name}" no es una imagen (PNG, JPG o WEBP)`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        newErrors.push(`"${file.name}" excede el limite de 25MB`);
        continue;
      }
      if (files.length + validFiles.length >= MAX_FILES) {
        newErrors.push(`Maximo ${MAX_FILES} imagenes permitidas`);
        break;
      }
      const alreadyAdded = files.some((f) => f.name === file.name && f.size === file.size);
      if (alreadyAdded) {
        newErrors.push(`"${file.name}" ya fue agregada`);
        continue;
      }
      validFiles.push(file);
    }

    setErrors(newErrors);
    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles]);
      for (const f of validFiles) {
        const url = URL.createObjectURL(f);
        setPreviews((prev) => new Map(prev).set(`${f.name}-${f.size}`, url));
      }
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
    if (e.dataTransfer.files.length > 0) validateAndAddFiles(e.dataTransfer.files);
  }, [validateAndAddFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAddFiles(e.target.files);
      e.target.value = '';
    }
  }, [validateAndAddFiles]);

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
            ? 'border-accent bg-accent/10 scale-[1.02]'
            : 'border-line bg-surface hover:border-accent/50 hover:bg-surface/80'
          }
          ${isProcessing ? 'pointer-events-none opacity-60' : ''}
 `}
      >
        <motion.div
          animate={isDragging ? { scale: 1.2, rotate: 5 } : { scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300 }}
        >
          <Upload className="w-12 h-12 text-accent" />
        </motion.div>
        <div className="text-center">
          <p className="text-ink text-lg font-medium">Arrastra imagenes de anuncios aqui</p>
          <p className="text-ink-3 text-sm mt-1">o haz clic para seleccionar archivos</p>
          <p className="text-ink-4 text-xs mt-2">PNG, JPG o WEBP · Maximo {MAX_FILES} imagenes</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
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
              <div key={i} className="flex items-center gap-2 text-sm text-danger">
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
          const key = `${file.name}-${file.size}`;
          const fileProgress = progress.get(file.name);
          const stage = fileProgress?.stage ?? 'idle';
          const percent = fileProgress?.percent ?? 0;
          const preview = previews.get(key);

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-surface border border-line rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 min-w-0">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt={file.name} className="w-10 h-10 rounded-lg object-cover border border-line shrink-0" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-accent shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-ink text-sm font-medium truncate">{file.name}</p>
                    <p className="text-ink-4 text-xs">{formatFileSize(file.size)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-mono ${
                    stage === 'Completado' ? 'text-ok' :
                    stage.startsWith('Error') ? 'text-danger' :
                    'text-ink-3'
                  }`}>
                    {stage === 'idle' ? 'Listo' : stage}
                  </span>
                  {!isProcessing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                      className="text-ink-4 hover:text-danger transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {stage !== 'idle' && stage !== 'Completado' && !stage.startsWith('Error') && percent >= 0 && (
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-accent"
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              )}
              {stage === 'Completado' && (
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full w-full rounded-full bg-ok" />
                </div>
              )}
              {stage.startsWith('Error') && (
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full w-full rounded-full bg-danger" />
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Analyze Button */}
      <motion.button
        whileHover={files.length > 0 && !isProcessing ? { scale: 1.02 } : {}}
        whileTap={files.length > 0 && !isProcessing ? { scale: 0.98 } : {}}
        onClick={() => files.length > 0 && !isProcessing && onAnalyze(files)}
        disabled={files.length === 0 || isProcessing}
        className={`
          w-full py-4 px-8 rounded-xl text-lg font-semibold transition-all duration-300
          ${files.length > 0 && !isProcessing
            ? 'bg-accent text-on-accent shadow-lg  hover:'
            : 'bg-surface-2 text-ink-4 cursor-not-allowed'
          }
 `}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center gap-3">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-5 h-5 border-2 border-on-accent/30 border-t-white rounded-full"
            />
            Diseccionando...
          </span>
        ) : (
 `Diseccionar ${files.length > 0 ? `(${files.length} imagen${files.length > 1 ? 'es' : ''})` : ''}`
        )}
      </motion.button>
    </div>
  );
}
