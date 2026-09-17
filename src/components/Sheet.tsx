'use client';

// =============================================================================
// Sheet — la vista de hoja de cálculo del Cerebro.
//
// POR QUÉ: los bancos del Cerebro (personas, conceptos) se veían como tarjetas
// verticales con diez campos abiertos cada una. Con siete avatares eso son
// setenta cajas de texto apiladas: para comparar el "hueco de educación" de dos
// avatares había que scrollear entre ellos y recordar. Comparar es justamente
// lo que uno hace con un banco de avatares.
//
// Aquí cada entidad es UN renglón y cada campo UNA columna. La primera columna
// se queda fija al hacer scroll horizontal, así que nunca se pierde de vista de
// quién es el renglón. Las celdas se editan en su lugar, en corto; cuando un
// campo necesita espacio real, el renglón se abre a lo ancho y ahí sí se ve
// todo completo.
//
// El componente no sabe nada de personas ni de conceptos: recibe columnas con
// su `render`. Eso es lo que deja que las dos pestañas compartan esta vista sin
// heredar los campos de la otra.
// =============================================================================

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

export interface SheetCol<T> {
  key: string;
  label: string;
  /** Ancho en píxeles. Sin esto las columnas se pelean y el texto salta. */
  width?: number;
  /** Se muestra al pasar el cursor por el encabezado. */
  hint?: string;
  /** La celda. Normalmente un <Field> compacto. */
  render: (row: T) => ReactNode;
}

export interface SheetProps<T> {
  rows: T[];
  cols: SheetCol<T>[];
  /** Ancho de la columna fija de la izquierda. */
  stickyWidth?: number;
  stickyLabel: string;
  /** El contenido de la columna fija: normalmente el nombre, editable. */
  sticky: (row: T) => ReactNode;
  /** Lo que se ve cuando el renglón se abre a lo ancho. Sin esto no hay abrir. */
  detail?: (row: T) => ReactNode;
  onRemove?: (row: T) => void;
  rowKey: (row: T) => string;
}

export default function Sheet<T>({
  rows, cols, sticky, stickyLabel, stickyWidth = 220, detail, onRemove, rowKey,
}: SheetProps<T>) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const total = stickyWidth + cols.reduce((s, c) => s + (c.width ?? 200), 0) + 44;

  return (
    <div className="rounded-xl border border-line bg-surface overflow-x-auto">
      <table className="text-xs border-collapse" style={{ width: total, tableLayout: 'fixed' }}>
        <thead>
          <tr className="bg-surface-2">
            <th
              className="sticky left-0 z-20 bg-surface-2 text-left px-3 py-2 font-medium text-ink-2 border-b border-r border-line"
              style={{ width: stickyWidth }}
            >
              {stickyLabel}
            </th>
            {cols.map((c) => (
              <th
                key={c.key}
                title={c.hint}
                className="text-left px-2 py-2 font-medium text-ink-3 border-b border-line align-bottom"
                style={{ width: c.width ?? 200 }}
              >
                <span className="block truncate text-[10px] uppercase tracking-wide">{c.label}</span>
              </th>
            ))}
            <th className="border-b border-line" style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = rowKey(r);
            const open = abierto === k;
            return (
              <FilaGrupo key={k}>
                <tr className={`border-b border-line/60 align-top ${open ? 'bg-accent-soft/30' : 'hover:bg-surface-2/50'}`}>
                  <td
                    className={`sticky left-0 z-10 px-2 py-2 border-r border-line ${open ? 'bg-canvas' : 'bg-canvas'}`}
                    style={{ width: stickyWidth }}
                  >
                    <div className="flex items-start gap-1">
                      {detail && (
                        <button
                          onClick={() => setAbierto(open ? null : k)}
                          className="mt-1.5 shrink-0 text-ink-4 hover:text-ink-1"
                          title={open ? 'Cerrar' : 'Abrir a lo ancho'}
                        >
                          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <div className="min-w-0 flex-1">{sticky(r)}</div>
                    </div>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className="px-1.5 py-2 align-top" style={{ width: c.width ?? 200 }}>
                      {c.render(r)}
                    </td>
                  ))}
                  <td className="px-2 py-2 align-top" style={{ width: 44 }}>
                    {onRemove && (
                      <button
                        onClick={() => onRemove(r)}
                        className="mt-1.5 text-ink-4 hover:text-danger"
                        title="Eliminar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
                {open && detail && (
                  <tr className="border-b-2 border-accent/30 bg-canvas">
                    <td colSpan={cols.length + 2} className="p-0">
                      {/* El contenido se ancla a la izquierda de la VENTANA, no de
                          la tabla: si no, abrir un renglón con scroll a la derecha
                          dejaría el detalle fuera de pantalla. */}
                      <div className="sticky left-0 p-4" style={{ width: 'min(100vw, 1100px)' }}>
                        {detail(r)}
                      </div>
                    </td>
                  </tr>
                )}
              </FilaGrupo>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** <tbody> no acepta fragmentos con key en todos los targets; esto los agrupa. */
function FilaGrupo({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
