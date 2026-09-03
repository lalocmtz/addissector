import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { anthropic, anthropicApiKey, MODEL } from '@/lib/ai';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Documentos de marca: se destilan con Claude a un contexto creativo compacto
// que los planners usan siempre. POST {filename, dataBase64, mime} | GET | DELETE
// ---------------------------------------------------------------------------

async function requireOwnBrand(brandId: string, userId: string) {
  const sb = getSupabase();
  const { data } = await sb.from('brands').select('id').eq('id', brandId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) return NextResponse.json({ docs: [] });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const { data } = await getSupabase()
    .from('brand_docs')
    .select('id,filename,created_at')
    .eq('brand_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return NextResponse.json({ docs: data ?? [] });
}

interface UploadBody {
  filename: string;
  dataBase64: string; // contenido en base64
  mime: string;       // application/pdf | text/plain | text/markdown
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!isSupabaseConfigured() || !isAuthConfigured()) {
      return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    const { id } = await params;
    if (!(await requireOwnBrand(id, user.id))) {
      return NextResponse.json({ error: 'Marca no encontrada' }, { status: 404 });
    }

    const body = (await request.json()) as UploadBody;
    if (!body.dataBase64 || !body.filename) {
      return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
    }
    const bytes = Buffer.from(body.dataBase64, 'base64');
    if (bytes.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'El archivo supera 8 MB' }, { status: 400 });
    }

    // Destilar el documento a contexto creativo con Claude
    if (!anthropicApiKey()) return NextResponse.json({ error: 'Anthropic API key is not configured' }, { status: 500 });
    const client = anthropic();

    const instruction =
      'Extrae de este documento TODO el contexto útil para crear anuncios de esta marca: producto(s) y beneficios, avatar/cliente ideal, dolores, objeciones, tono de voz, claims permitidos, diferenciadores, precios/ofertas, frases textuales valiosas. Responde en español como texto plano estructurado y compacto (máx ~800 palabras). Sin introducciones.';

    const content: Anthropic.ContentBlockParam[] =
      body.mime === 'application/pdf'
        ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.dataBase64 } },
            { type: 'text', text: instruction },
          ]
        : [{ type: 'text', text: `${instruction}\n\nDOCUMENTO:\n${bytes.toString('utf8').slice(0, 60000)}` }];

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const extracted = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    const { data, error } = await getSupabase()
      .from('brand_docs')
      .insert({ user_id: user.id, brand_id: id, filename: body.filename, extracted_text: extracted })
      .select('id,filename,created_at')
      .single();
    if (error) throw error;

    return NextResponse.json({ doc: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error procesando el documento';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured() || !isAuthConfigured()) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 501 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const docId = request.nextUrl.searchParams.get('doc');
  if (!docId) return NextResponse.json({ error: 'Falta el doc' }, { status: 400 });
  await getSupabase().from('brand_docs').delete().eq('id', docId).eq('brand_id', id).eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}
