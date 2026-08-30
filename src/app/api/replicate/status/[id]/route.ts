import { NextRequest, NextResponse } from 'next/server';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';
import { getTaskStatus, isKieConfigured } from '@/lib/kie';

export const runtime = 'nodejs';
export const maxDuration = 60;

const GENERATIONS_BUCKET = 'generations';

// ---------------------------------------------------------------------------
// GET /api/replicate/status/[id] — consulta el estado de una generación.
// Si Kie ya terminó, descarga el archivo y lo guarda en nuestro storage
// (Kie borra los archivos a los 14 días).
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAuthConfigured() || !isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Auth no está configurado' }, { status: 500 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    const { id } = await params;
    const sb = getSupabase();

    const { data: gen, error } = await sb
      .from('generations')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!gen) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });

    // Ya terminó (éxito o error definitivo): responde tal cual.
    if (gen.status === 'success' || gen.status === 'failed' || !gen.kie_task_id) {
      return NextResponse.json({ generation: gen });
    }
    if (!isKieConfigured()) return NextResponse.json({ generation: gen });

    const task = await getTaskStatus(gen.kie_task_id);

    if (task.state === 'failed') {
      const { data: updated } = await sb
        .from('generations')
        .update({
          status: 'failed',
          error: task.error || 'La generación falló en Kie.ai',
          updated_at: new Date().toISOString(),
        })
        .eq('id', gen.id)
        .select('*')
        .single();
      return NextResponse.json({ generation: updated ?? gen });
    }

    if (task.state === 'success' && task.resultUrls.length > 0) {
      // Persistimos el archivo en nuestro bucket público.
      let finalUrl = task.resultUrls[0];
      try {
        const res = await fetch(task.resultUrls[0]);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          const isVideo = gen.kind === 'video';
          const ext = isVideo ? 'mp4' : 'png';
          const contentType = isVideo ? 'video/mp4' : 'image/png';
          const path = `${user.id}/${gen.id}.${ext}`;
          const { error: upErr } = await sb.storage
            .from(GENERATIONS_BUCKET)
            .upload(path, buffer, { contentType, upsert: true });
          if (!upErr) {
            finalUrl = sb.storage.from(GENERATIONS_BUCKET).getPublicUrl(path).data.publicUrl;
          }
        }
      } catch {
        /* si falla la copia usamos la URL de Kie (dura 14 días) */
      }

      const { data: updated } = await sb
        .from('generations')
        .update({
          status: 'success',
          result_url: finalUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', gen.id)
        .select('*')
        .single();
      return NextResponse.json({ generation: updated ?? gen });
    }

    // Sigue en proceso
    return NextResponse.json({ generation: { ...gen, status: 'processing' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error consultando la generación';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
