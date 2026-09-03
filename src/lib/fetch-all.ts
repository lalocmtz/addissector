// =============================================================================
// fetchAll — PostgREST caps every response at max-rows (1000 by default), and
// `.limit(50000)` does NOT lift that cap: the query silently returns the first
// 1000 rows. Anything that reads ad_daily (≈5k rows per brand and growing)
// must page with Range headers. Give it a factory that builds the ordered
// query; it walks the pages until one comes back short.
// =============================================================================

interface Pageable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export const PAGE = 1000;

export async function fetchAll<T>(make: () => Pageable<T>, opts: { page?: number; max?: number } = {}): Promise<T[]> {
  const page = opts.page ?? PAGE;
  const max = opts.max ?? 200_000;
  const out: T[] = [];
  for (let from = 0; from < max; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}
