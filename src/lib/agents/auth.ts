// Shared auth for agent routes: a user session, or the cron secret.
import { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/supabase-server';

export async function agentCaller(request: NextRequest): Promise<{ userId: string | null; cron: boolean } | null> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (secret && (auth === `Bearer ${secret}` || request.headers.get('x-cron-secret') === secret)) return { userId: null, cron: true };
  const user = await getSessionUser();
  return user ? { userId: user.id, cron: false } : null;
}
