// =============================================================================
// meta-sync v5 — the ONLY writer of ad_daily and of ad_account.currency.
//
// Runs hourly from pg_cron (job "meta-sync-hourly") and on demand:
//   ?days=7                      last N days, every active ad_account
//   ?since=YYYY-MM-DD&until=...  explicit window (backfill, one month per call)
//   ?brand=<uuid>                only that brand's account(s)
//
// What it writes, per (brand, ad_id, day): COUNTS only. Every rate (hook_rate,
// hold_rate, ret25..ret100, roas, cpa, cpm, cvr…) is a generated column in
// ad_daily whose definitions mirror src/lib/metrics.ts. The 3-second view
// count comes from actions[video_view] — that IS Meta's "3-second video plays";
// video_play_actions (any start, autoplay included) is stored apart as `plays`.
//
// Rows are keyed by ad_id, never by name. Two ads with the same name are two
// rows. Days with zero spend and zero impressions (the ad existed but did not
// deliver) are not stored.
//
// Quota: Meta limits by app and by rhythm. Rate-limit errors (#4/#17/#32/#613/
// #80004) back off with growing waits; if Meta says how long to wait, the run
// stops and reports it rather than making the lockout longer.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v25.0";
const INSIGHTS_LIMIT = 500;   // insights have no nested-field trap
const ADS_LIMIT = 100;        // /ads with nested fields: >100 returns [] silently

// Fields that every Graph version we target supports.
const CORE_FIELDS = [
  "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "date_start",
  "spend", "impressions", "reach", "frequency", "inline_link_clicks",
  "actions", "action_values",
  "video_play_actions", "video_thruplay_watched_actions",
  "video_p25_watched_actions", "video_p50_watched_actions",
  "video_p75_watched_actions", "video_p100_watched_actions",
];
// Nice-to-have fields. If Meta rejects one (#100 "is not valid for fields"),
// the request is retried with the core set only — the sync never dies over them.
const OPTIONAL_FIELDS = ["video_15_sec_watched_actions", "video_play_curve_actions"];

type Json = Record<string, unknown>;
type ActionEntry = { action_type: string; value: string };

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sum of an action_type family. Null when the list has none of them. */
function actionSum(list: unknown, ...types: string[]): number | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  let total = 0, found = false;
  for (const a of list as ActionEntry[]) {
    if (types.includes(a.action_type)) {
      const v = Number(a.value);
      if (Number.isFinite(v)) { total += v; found = true; }
    }
  }
  return found ? total : null;
}
const videoView = (list: unknown) => actionSum(list, "video_view");
const PURCHASE = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const ATC = ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];

class MetaError extends Error {
  code: number; waitMin: number;
  constructor(msg: string, code: number, waitMin = 0) { super(msg); this.code = code; this.waitMin = waitMin; }
}
const isRateLimit = (e: unknown) => e instanceof MetaError && [4, 17, 32, 613, 80004].includes(e.code);

/** Reads Meta's quota headers: estimated_time_to_regain_access in minutes. */
function waitFromHeaders(res: Response): number {
  let wait = 0;
  for (const h of ["x-business-use-case-usage", "x-ad-account-usage", "x-app-usage"]) {
    const raw = res.headers.get(h);
    if (!raw) continue;
    try {
      const j = JSON.parse(raw);
      const entries = Array.isArray(j) ? j : Object.values(j).flat();
      for (const e of entries as Array<Record<string, number>>) {
        wait = Math.max(wait, e?.estimated_time_to_regain_access ?? 0);
      }
    } catch { /* ignore */ }
  }
  return wait;
}

async function graphGet(url: string): Promise<Json> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    const wait = waitFromHeaders(res);
    const json = await res.json() as Json & { error?: { message: string; code: number } };
    if (!json.error) return json;
    const err = new MetaError(json.error.message, json.error.code, wait);
    if (!isRateLimit(err) || wait > 0 || attempt === 3) throw err;
    last = err;
    await sleep(4000 * (attempt + 1));
  }
  throw last;
}

async function graphAll(firstUrl: string, cap: number): Promise<Json[]> {
  const out: Json[] = [];
  let next: string | null = firstUrl;
  for (let i = 0; next && i < cap; i++) {
    const json = await graphGet(next) as { data?: Json[]; paging?: { next?: string } };
    out.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
    if (next) await sleep(150); // rhythm, not total, is what trips the limit
  }
  return out;
}

function insightsUrl(act: string, token: string, since: string, until: string, fields: string[]) {
  const q = new URLSearchParams({
    level: "ad", time_increment: "1", limit: String(INSIGHTS_LIMIT),
    fields: fields.join(","),
    time_range: JSON.stringify({ since, until }),
    access_token: token,
  });
  return `${GRAPH}/${act}/insights?${q}`;
}

async function fetchInsights(act: string, token: string, since: string, until: string) {
  try {
    return await graphAll(insightsUrl(act, token, since, until, [...CORE_FIELDS, ...OPTIONAL_FIELDS]), 200);
  } catch (e) {
    if (e instanceof MetaError && e.code === 100) {
      // An optional field is not valid on this version: degrade, don't die.
      return await graphAll(insightsUrl(act, token, since, until, CORE_FIELDS), 200);
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const brandFilter = url.searchParams.get("brand");
  const today = new Date().toISOString().slice(0, 10);
  let since = url.searchParams.get("since");
  let until = url.searchParams.get("until") ?? today;
  if (!since) {
    const days = Math.min(Math.max(num(url.searchParams.get("days")) ?? 7, 1), 90);
    since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  }
  if (until > today) until = today;

  let q = sb.from("ad_account")
    .select("id, brand_id, user_id, ad_account_id, access_token, active")
    .eq("active", true).not("access_token", "is", null);
  if (brandFilter) q = q.eq("brand_id", brandFilter);
  const { data: accounts, error: accErr } = await q;
  if (accErr) return json({ error: accErr.message }, 500);
  if (!accounts?.length) return json({ ok: false, msg: "no active ad_account with a token" });

  const results: Json[] = [];
  for (const acc of accounts) {
    const token = acc.access_token as string;
    const act = acc.ad_account_id as string;
    let upserted = 0, adsSeen = 0;
    const startedAt = Date.now();
    try {
      // 1. Account facts — currency and timezone are DERIVED, never typed by hand.
      const meta = await graphGet(`${GRAPH}/${act}?fields=name,currency,timezone_name&access_token=${token}`) as
        { name?: string; currency?: string; timezone_name?: string };
      if (meta.currency) {
        await sb.from("ad_account").update({
          name: meta.name ?? null, currency: meta.currency, currency_source: "meta",
          timezone: meta.timezone_name ?? null, updated_at: new Date().toISOString(),
        }).eq("id", acc.id);
      }

      // 2. Daily insights, one row per ad per day
      const raw = await fetchInsights(act, token, since, until);

      // 3. Ad dimension: status, names, created_time (paged at 100 for the nested fields)
      const ads = await graphAll(
        `${GRAPH}/${act}/ads?fields=id,name,effective_status,created_time,adset{id,name},campaign{id,name}&limit=${ADS_LIMIT}&access_token=${token}`,
        60,
      );
      adsSeen = ads.length;
      const adById = new Map<string, Json>();
      for (const a of ads) adById.set(String(a.id), a);

      // 4. Build rows — keyed by ad_id + date. Same ad in two adsets on one day is summed.
      const rows = new Map<string, Json>();
      for (const r of raw as Array<Record<string, unknown>>) {
        const spend = num(r.spend) ?? 0;
        const impressions = num(r.impressions) ?? 0;
        if (spend === 0 && impressions === 0) continue; // no delivery: no information
        const adId = String(r.ad_id);
        const key = `${adId}|${r.date_start}`;
        const ad = adById.get(adId);
        const prev = rows.get(key) as Record<string, number | string | null | unknown> | undefined;
        const add = (a: unknown, b: unknown): number | null => {
          const x = a as number | null, y = b as number | null;
          if (x == null && y == null) return null;
          return (x ?? 0) + (y ?? 0);
        };
        const cur: Record<string, unknown> = prev ?? {
          user_id: acc.user_id, brand_id: acc.brand_id, ad_id: adId, ad_name: r.ad_name, date: r.date_start,
          source: "api", metrics_version: 1, legacy_ambiguous: false,
          status: ad ? String((ad.effective_status ?? "")).toLowerCase() : null,
          adset_id: r.adset_id ?? null, adset_name: r.adset_name ?? null,
          campaign_id: r.campaign_id ?? null, campaign_name: r.campaign_name ?? null,
          spend: 0, revenue: null, purchases: null, atc: null, impressions: 0, reach: null, freq: null,
          link_clicks: null, plays: null, v3s: null, thruplay: null, v15s: null,
          v25: null, v50: null, v75: null, v100: null, play_curve: null,
          updated_at: new Date().toISOString(),
        };
        const freqPrev = (cur.freq as number | null) ?? 0;
        const impPrev = cur.impressions as number;
        cur.spend = (cur.spend as number) + spend;
        cur.impressions = impPrev + impressions;
        cur.reach = add(cur.reach, num(r.reach));
        // frequency is a ratio: keep it impression-weighted
        const f = num(r.frequency);
        cur.freq = (cur.impressions as number) > 0 && f != null
          ? (freqPrev * impPrev + f * impressions) / (cur.impressions as number) : cur.freq;
        cur.link_clicks = add(cur.link_clicks, num(r.inline_link_clicks));
        cur.purchases = add(cur.purchases, actionSum(r.actions, ...PURCHASE));
        cur.revenue = add(cur.revenue, actionSum(r.action_values, ...PURCHASE));
        cur.atc = add(cur.atc, actionSum(r.actions, ...ATC));
        cur.plays = add(cur.plays, videoView(r.video_play_actions));
        cur.v3s = add(cur.v3s, videoView(r.actions));           // 3-second video plays
        cur.thruplay = add(cur.thruplay, videoView(r.video_thruplay_watched_actions));
        cur.v15s = add(cur.v15s, videoView(r.video_15_sec_watched_actions));
        cur.v25 = add(cur.v25, videoView(r.video_p25_watched_actions));
        cur.v50 = add(cur.v50, videoView(r.video_p50_watched_actions));
        cur.v75 = add(cur.v75, videoView(r.video_p75_watched_actions));
        cur.v100 = add(cur.v100, videoView(r.video_p100_watched_actions));
        if (Array.isArray(r.video_play_curve_actions) && !cur.play_curve) {
          cur.play_curve = (r.video_play_curve_actions as Array<{ value?: unknown }>)[0]?.value ?? null;
        }
        rows.set(key, cur);
      }

      const daily = [...rows.values()];
      for (let i = 0; i < daily.length; i += 400) {
        const chunk = daily.slice(i, i + 400);
        const { error } = await sb.from("ad_daily").upsert(chunk, { onConflict: "brand_id,ad_id,date" });
        if (error) throw new Error(`upsert ad_daily: ${error.message}`);
        upserted += chunk.length;
      }

      // 5. meta_ads keyed by ad_id: names, status, seen range. Asset columns untouched.
      const byAd = new Map<string, { name: string; first: string; last: string; adset: unknown; campaign: unknown }>();
      for (const d of daily as Array<Record<string, string>>) {
        const cur = byAd.get(d.ad_id) ?? { name: d.ad_name, first: d.date, last: d.date, adset: d.adset_name, campaign: d.campaign_id };
        if (d.date < cur.first) cur.first = d.date;
        if (d.date >= cur.last) { cur.last = d.date; cur.name = d.ad_name; }
        byAd.set(d.ad_id, cur);
      }
      const { data: existing } = await sb.from("meta_ads").select("ad_id,first_seen,last_seen").eq("brand_id", acc.brand_id);
      const prevById = new Map((existing ?? []).map((e: Record<string, string>) => [e.ad_id, e]));
      const adRows = [...byAd.entries()].map(([adId, v]) => {
        const ad = adById.get(adId);
        const prev = prevById.get(adId);
        return {
          user_id: acc.user_id, brand_id: acc.brand_id, ad_id: adId, name: v.name,
          status: ad ? String(ad.effective_status ?? "").toLowerCase() : null,
          created_date: ad?.created_time ? String(ad.created_time).slice(0, 10) : null,
          adset_id: (ad?.adset as Json | undefined)?.id ?? null,
          adset_name: (ad?.adset as Json | undefined)?.name ?? v.adset ?? null,
          campaign_id: (ad?.campaign as Json | undefined)?.id ?? v.campaign ?? null,
          first_seen: prev?.first_seen && prev.first_seen < v.first ? prev.first_seen : v.first,
          last_seen: prev?.last_seen && prev.last_seen > v.last ? prev.last_seen : v.last,
          updated_at: new Date().toISOString(),
        };
      });
      for (let i = 0; i < adRows.length; i += 200) {
        const { error } = await sb.from("meta_ads").upsert(adRows.slice(i, i + 200), { onConflict: "brand_id,ad_id" });
        if (error) throw new Error(`upsert meta_ads: ${error.message}`);
      }

      await sb.from("ad_account").update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", acc.id);
      const detail = `v5 ${since}→${until}: ${raw.length} insight rows, ${daily.length} ad-days, ${adRows.length} ads, ${Math.round((Date.now() - startedAt) / 1000)}s`;
      await sb.from("sync_logs").insert({ brand_id: acc.brand_id, ok: true, rows_upserted: upserted, detail });
      results.push({ account: act, ok: true, rows: upserted, ads: adsSeen, currency: meta.currency ?? null });
    } catch (e) {
      const msg = e instanceof MetaError ? `[${e.code}] ${e.message}${e.waitMin ? ` (wait ${e.waitMin} min)` : ""}` : String(e);
      await sb.from("ad_account").update({ last_sync_error: msg }).eq("id", acc.id);
      await sb.from("sync_logs").insert({ brand_id: acc.brand_id, ok: false, rows_upserted: upserted, detail: `v5 ${since}→${until}: ${msg}`.slice(0, 1800) });
      results.push({ account: act, ok: false, error: msg, rateLimited: isRateLimit(e), waitMin: e instanceof MetaError ? e.waitMin : 0 });
    }
  }
  return json({ ok: true, since, until, results });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
