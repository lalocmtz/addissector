// =============================================================================
// El portero del modo TikTok Shop.
//
// El modo es de una sola persona por ahora, y "de una sola persona" no puede
// depender de que la UI no muestre el botón: cualquiera que sepa la URL de la
// API entraría. La llave vive en app_settings (tiktok_shop_enabled = '1') y se
// revisa EN EL SERVIDOR en cada ruta del modo, no en el cliente.
// =============================================================================

import { getSupabase } from '@/lib/supabase';

export const TIKTOK_FLAG = 'tiktok_shop_enabled';

/** ¿Este usuario tiene desbloqueado el modo? */
export async function tiktokEnabled(userId: string): Promise<boolean> {
  const sb = getSupabase();
  try {
    const { data } = await sb.from('app_settings').select('value')
      .eq('user_id', userId).eq('key', TIKTOK_FLAG).maybeSingle();
    return String((data as { value?: unknown } | null)?.value ?? '').trim() === '1';
  } catch {
    return false;
  }
}

/** La marca existe, es del usuario Y es del modo TikTok Shop. */
export async function tiktokBrand(brandId: string, userId: string): Promise<{ id: string; name: string } | null> {
  const sb = getSupabase();
  const { data } = await sb.from('brands').select('id,name,kind')
    .eq('id', brandId).eq('user_id', userId).maybeSingle();
  const b = data as { id: string; name: string; kind?: string } | null;
  if (!b || b.kind !== 'tiktok_shop') return null;
  return { id: b.id, name: b.name };
}
