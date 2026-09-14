// =============================================================================
// Contador de cambios sin guardar.
//
// Los campos del Cerebro guardaban SOLO en blur: escribir y recargar sin hacer
// clic fuera perdia el texto, sin aviso. Ahora guardan con debounce, pero entre
// la tecla y el guardado sigue habiendo una ventana. Este contador la vigila:
// un campo se marca sucio al escribir y se limpia cuando su guardado termina.
//
// `usePendingWarning()` engancha beforeunload mientras haya algo sucio, asi que
// cerrar o recargar la pestana pide confirmacion en vez de tragarse el texto.
// =============================================================================

import { useEffect } from 'react';

let pendientes = 0;
const subs = new Set<(n: number) => void>();

function avisar() {
  for (const f of subs) f(pendientes);
}

/** Marca un cambio sin guardar. Idempotente por campo: usa el ref del campo. */
export function beginPending(): void {
  pendientes += 1;
  avisar();
}

/** Lo contrario. Nunca baja de cero aunque se llame de mas. */
export function endPending(): void {
  pendientes = Math.max(0, pendientes - 1);
  avisar();
}

export function pendingCount(): number {
  return pendientes;
}

export function subscribePending(f: (n: number) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}

/** Pide confirmacion al cerrar o recargar si queda algo sin guardar. */
export function usePendingWarning(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendientes <= 0) return;
      e.preventDefault();
      // Chrome ignora el texto, pero necesita returnValue para mostrar el aviso.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
