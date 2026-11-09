import { database } from "./database";
import { buildDashboard, classifyPost, localDay, readXDailySettings, searchQuery, tierOf, validateXDailySettings, xRates, type Activity, type ActivityRow, type Person, type XDailyDashboard, type XDailySettings } from "./x-daily";
import { readerError, xReadConfigured, type FoundPost, type XReader, type XUser } from "./x-daily-reader";

type StateRow = {
  settings: unknown; account_id: string | null; account_username: string; newest_post_id: string | null; newest_mention_id: string | null;
  tracking_since: Date | null; search_day: string; search_token: string; sync_started_at: Date | null; sync_finished_at: Date | null; synced_at: Date | null; sync_error: string;
};
export type XDailyStatus = { connected: boolean; account: string; syncedAt: string | null; syncError: string; trackingSince: string | null; syncing: boolean };
export type XDailyUsage = { today: { ownedReads: number; postReads: number; userReads: number }; monthCost: number; todayCost: number };
export type XDailyView = { settings: XDailySettings; status: XDailyStatus; dashboard: XDailyDashboard; usage: XDailyUsage };
export type SyncResult = { status: "synced" | "busy" | "error"; added?: number; discovered?: number; error?: string };

const db = () => database();
const BACKFILL_DAYS = 7; const MENTION_BACKFILL_DAYS = 3; const MAX_PAGES = 10; const STALE_FOLLOWERS_DAYS = 30;
const cost = (row: { owned_reads: number; post_reads: number; user_reads: number }) => row.owned_reads * xRates.ownedRead + row.post_reads * xRates.postRead + row.user_reads * xRates.userRead;

async function readStateRow() { return (await db().query<StateRow>("SELECT * FROM weekendcheck.x_daily_state WHERE id = 1")).rows[0]; }
export async function readXDailySettingsFromDb() { return readXDailySettings((await readStateRow())?.settings); }

async function usageFor(day: string) {
  const { rows } = await db().query<{ owned_reads: number; post_reads: number; user_reads: number }>("SELECT owned_reads, post_reads, user_reads FROM weekendcheck.x_daily_usage WHERE day = $1::date", [day]);
  return rows[0] || { owned_reads: 0, post_reads: 0, user_reads: 0 };
}
async function addUsage(day: string, usage: { owned?: number; post?: number; user?: number }) {
  if (!usage.owned && !usage.post && !usage.user) return;
  await db().query(`INSERT INTO weekendcheck.x_daily_usage(day, owned_reads, post_reads, user_reads) VALUES ($1::date, $2, $3, $4)
    ON CONFLICT(day) DO UPDATE SET owned_reads = x_daily_usage.owned_reads + $2, post_reads = x_daily_usage.post_reads + $3, user_reads = x_daily_usage.user_reads + $4`, [day, usage.owned || 0, usage.post || 0, usage.user || 0]);
}

export async function readXDaily(now = Date.now()): Promise<XDailyView> {
  const state = await readStateRow(); const settings = readXDailySettings(state?.settings);
  const [activity, people, usage] = await Promise.all([
    db().query<{ post_id: string; created_at: Date; kind: ActivityRow["kind"]; replied_to_user_id: string | null; replied_to_post_id: string | null }>(
      "SELECT post_id, created_at, kind, replied_to_user_id, replied_to_post_id FROM weekendcheck.x_daily_activity WHERE created_at > $1 ORDER BY created_at", [new Date(now - 90 * 86400000)]),
    db().query<PersonRow>(`SELECT * FROM weekendcheck.x_daily_people WHERE warm = 'pinned' OR (discovery_status = 'new' AND discovered_at > $1)
      OR user_id IN (SELECT replied_to_user_id FROM weekendcheck.x_daily_activity WHERE created_at > $1 AND replied_to_user_id IS NOT NULL)`, [new Date(now - 15 * 86400000)]),
    db().query<{ day: string; owned_reads: number; post_reads: number; user_reads: number }>("SELECT day::text AS day, owned_reads, post_reads, user_reads FROM weekendcheck.x_daily_usage WHERE day >= $1::date", [`${localDay(now, settings.timezone).slice(0, 7)}-01`]),
  ]);
  const today = localDay(now, settings.timezone);
  const todayUsage = usage.rows.find(row => row.day === today) || { owned_reads: 0, post_reads: 0, user_reads: 0 };
  const rows = activity.rows.map(row => ({ postId: row.post_id, createdAt: row.created_at.toISOString(), kind: row.kind, repliedToUserId: row.replied_to_user_id, repliedToPostId: row.replied_to_post_id }));
  const syncing = Boolean(state?.sync_started_at && (!state.sync_finished_at || state.sync_finished_at < state.sync_started_at) && now - state.sync_started_at.getTime() < 300000);
  return {
    settings,
    status: { connected: xReadConfigured(), account: state?.account_username || "", syncedAt: state?.synced_at?.toISOString() || null, syncError: state?.sync_error || "", trackingSince: state?.tracking_since?.toISOString() || null, syncing },
    dashboard: buildDashboard(settings, rows, people.rows.map(toPerson), now),
    usage: { today: { ownedReads: todayUsage.owned_reads, postReads: todayUsage.post_reads, userReads: todayUsage.user_reads }, todayCost: cost(todayUsage), monthCost: usage.rows.reduce((sum, row) => sum + cost(row), 0) },
  };
}

type PersonRow = {
  user_id: string; username: string; name: string; followers: number | null; followers_checked_at: Date | null; first_replied_at: Date | null; last_replied_at: Date | null; warm: Person["warm"];
  discovered_at: Date | null; discovery_source: Person["discoverySource"]; discovery_keyword: string; discovery_post_id: string | null; discovery_text: string; discovery_status: Person["discoveryStatus"];
};
const toPerson = (row: PersonRow): Person => ({
  userId: row.user_id, username: row.username, name: row.name, followers: row.followers, firstRepliedAt: row.first_replied_at?.toISOString() || null, lastRepliedAt: row.last_replied_at?.toISOString() || null, warm: row.warm,
  discoveredAt: row.discovered_at?.toISOString() || null, discoverySource: row.discovery_source, discoveryKeyword: row.discovery_keyword, discoveryPostId: row.discovery_post_id, discoveryText: row.discovery_text, discoveryStatus: row.discovery_status,
});

export async function saveXDailySettings(raw: unknown) {
  const settings = validateXDailySettings(raw);
  await db().query("UPDATE weekendcheck.x_daily_state SET settings = $1::jsonb WHERE id = 1", [JSON.stringify(settings)]);
  return settings;
}

const personOps = {
  pin: "warm = 'pinned'", unpin: "warm = 'auto'", hide: "warm = 'hidden'",
  done: "discovery_status = 'done'", skip: "discovery_status = 'skipped'", restore: "discovery_status = 'new'",
} as const;
export async function updateXDailyPerson(userId: unknown, op: unknown) {
  if (typeof userId !== "string" || !/^\d{1,20}$/.test(userId)) throw new Error("Account not found.");
  if (typeof op !== "string" || !(op in personOps)) throw new Error("Unknown action.");
  const result = await db().query(`UPDATE weekendcheck.x_daily_people SET ${personOps[op as keyof typeof personOps]} WHERE user_id = $1`, [userId]);
  if (!result.rowCount) throw new Error("Account not found.");
}

// One sync at a time, at most once a minute. A crashed sync is taken over after five minutes.
async function claimSync(now: number) {
  const { rows } = await db().query<StateRow>(`UPDATE weekendcheck.x_daily_state SET sync_started_at = $1::timestamptz WHERE id = 1
    AND (sync_started_at IS NULL OR (sync_started_at < $1::timestamptz - interval '60 seconds' AND (sync_finished_at >= sync_started_at OR sync_started_at < $1::timestamptz - interval '5 minutes')))
    RETURNING *`, [new Date(now)]);
  return rows[0] || null;
}

async function saveActivity(items: Activity[]) {
  if (!items.length) return 0;
  const inserted = await db().query(`INSERT INTO weekendcheck.x_daily_activity(post_id, created_at, kind, replied_to_user_id, replied_to_post_id)
    SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::text[]) ON CONFLICT DO NOTHING`,
  [items.map(i => i.postId), items.map(i => i.createdAt), items.map(i => i.kind), items.map(i => i.repliedToUserId), items.map(i => i.repliedToPostId)]);
  const people = new Map<string, { username: string; first: string; last: string }>();
  for (const item of items) {
    if (item.kind !== "reply" || !item.repliedToUserId) continue;
    const current = people.get(item.repliedToUserId);
    people.set(item.repliedToUserId, { username: item.repliedToUsername || current?.username || "", first: current && current.first < item.createdAt ? current.first : item.createdAt, last: current && current.last > item.createdAt ? current.last : item.createdAt });
  }
  const list = [...people];
  if (list.length) await db().query(`INSERT INTO weekendcheck.x_daily_people(user_id, username, first_replied_at, last_replied_at)
    SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::timestamptz[])
    ON CONFLICT(user_id) DO UPDATE SET username = COALESCE(NULLIF(EXCLUDED.username, ''), x_daily_people.username),
      first_replied_at = LEAST(x_daily_people.first_replied_at, EXCLUDED.first_replied_at), last_replied_at = GREATEST(x_daily_people.last_replied_at, EXCLUDED.last_replied_at),
      discovery_status = CASE WHEN x_daily_people.discovery_status = 'new' THEN 'done' ELSE x_daily_people.discovery_status END`,
  [list.map(([id]) => id), list.map(([, p]) => p.username), list.map(([, p]) => p.first), list.map(([, p]) => p.last)]);
  return inserted.rowCount || 0;
}

async function saveUsers(users: XUser[], now: number) {
  if (!users.length) return;
  await db().query(`INSERT INTO weekendcheck.x_daily_people(user_id, username, name, followers, followers_checked_at)
    SELECT id, username, name, followers, $5 FROM unnest($1::text[], $2::text[], $3::text[], $4::int[]) AS u(id, username, name, followers)
    ON CONFLICT(user_id) DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name, followers = EXCLUDED.followers, followers_checked_at = EXCLUDED.followers_checked_at`,
  [users.map(u => u.id), users.map(u => u.username.slice(0, 15)), users.map(u => u.name.slice(0, 100)), users.map(u => u.followers), new Date(now)]);
}

const snippet = (text: string | undefined) => (text || "").replace(/\s+/g, " ").trim().slice(0, 280);

export async function syncXDaily(reader: XReader, now = Date.now()): Promise<SyncResult> {
  const state = await claimSync(now);
  if (!state) return { status: "busy" };
  const settings = readXDailySettings(state.settings); const day = localDay(now, settings.timezone);
  try {
    let accountId = state.account_id; let username = state.account_username;
    if (!accountId) {
      const me = await reader.me(); accountId = me.id; username = me.username;
      await addUsage(day, { user: 1 });
      await db().query("UPDATE weekendcheck.x_daily_state SET account_id = $1, account_username = $2, tracking_since = COALESCE(tracking_since, $3) WHERE id = 1", [accountId, username, new Date(now - BACKFILL_DAYS * 86400000)]);
    }

    // 1. Own posts and replies since the last sync (first sync: the last week).
    let added = 0; let newest = state.newest_post_id || undefined; let token: string | undefined;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
      const page = await reader.timeline(accountId, { sinceId: state.newest_post_id || undefined, startTime: state.newest_post_id ? undefined : new Date(now - BACKFILL_DAYS * 86400000).toISOString(), token });
      await addUsage(day, { owned: page.posts.length });
      added += await saveActivity(page.posts.map(post => classifyPost(post, accountId!)).filter((item): item is Activity => Boolean(item)));
      if (pageNumber === 0 && page.newestId) newest = page.newestId;
      if (!page.next) break; token = page.next;
    }
    await db().query("UPDATE weekendcheck.x_daily_state SET newest_post_id = $1 WHERE id = 1", [newest || null]);

    // 2. People who replied to or mentioned you and you never replied to.
    let discovered = 0; let newestMention = state.newest_mention_id || undefined; token = undefined;
    const mentionAuthors = new Map<string, FoundPost>();
    for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
      const page = await reader.mentions(accountId, { sinceId: state.newest_mention_id || undefined, startTime: state.newest_mention_id ? undefined : new Date(now - MENTION_BACKFILL_DAYS * 86400000).toISOString(), token });
      await addUsage(day, { owned: page.posts.length });
      for (const post of page.posts) if (post.author_id && post.author_id !== accountId && /^\d{1,20}$/.test(post.author_id) && !mentionAuthors.has(post.author_id)) mentionAuthors.set(post.author_id, post);
      if (pageNumber === 0 && page.newestId) newestMention = page.newestId;
      if (!page.next) break; token = page.next;
    }
    if (mentionAuthors.size) {
      const known = new Set((await db().query<{ user_id: string }>("SELECT user_id FROM weekendcheck.x_daily_people WHERE user_id = ANY($1::text[]) AND (first_replied_at IS NOT NULL OR discovered_at IS NOT NULL)", [[...mentionAuthors.keys()]])).rows.map(row => row.user_id));
      const fresh = [...mentionAuthors].filter(([id]) => !known.has(id));
      if (fresh.length) {
        await db().query(`INSERT INTO weekendcheck.x_daily_people(user_id, discovered_at, discovery_source, discovery_post_id, discovery_text, discovery_status)
          SELECT id, $5, source, post, text, 'new' FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS m(id, source, post, text)
          ON CONFLICT(user_id) DO UPDATE SET discovered_at = $5, discovery_source = EXCLUDED.discovery_source, discovery_post_id = EXCLUDED.discovery_post_id, discovery_text = EXCLUDED.discovery_text, discovery_status = 'new'`,
        [fresh.map(([id]) => id), fresh.map(([, post]) => post.in_reply_to_user_id === accountId && post.referenced_tweets?.some(r => r.type === "replied_to") ? "reply" : "mention"), fresh.map(([, post]) => /^\d{1,20}$/.test(post.id) ? post.id : null), fresh.map(([, post]) => snippet(post.text)), new Date(now)]);
        discovered += fresh.length;
      }
    }
    await db().query("UPDATE weekendcheck.x_daily_state SET newest_mention_id = $1 WHERE id = 1", [newestMention || null]);

    // 3. Follower counts: people replied to and suggestions first, then a monthly refresh of recent contacts.
    let budget = Math.max(0, settings.lookupCap - (await usageFor(day)).user_reads);
    if (budget) {
      const { rows } = await db().query<{ user_id: string }>(`SELECT user_id FROM weekendcheck.x_daily_people
        WHERE (followers_checked_at IS NULL AND (first_replied_at IS NOT NULL OR discovery_status = 'new'))
          OR (followers_checked_at < $1 AND last_replied_at > $2)
        ORDER BY followers_checked_at IS NOT NULL, discovery_status IS NOT DISTINCT FROM 'new' DESC, last_replied_at DESC NULLS LAST LIMIT $3`,
      [new Date(now - STALE_FOLLOWERS_DAYS * 86400000), new Date(now - 14 * 86400000), budget]);
      for (let start = 0; start < rows.length; start += 100) {
        const ids = rows.slice(start, start + 100).map(row => row.user_id);
        const users = await reader.users(ids);
        await addUsage(day, { user: users.length }); await saveUsers(users, now); budget -= users.length;
      }
    }

    // 4. Keyword discovery: read 10 posts at a time and stop once today's target is met or a cap is hit.
    const query = searchQuery(settings, username);
    if (query && settings.discoverTarget > 0) {
      let found = Number((await db().query<{ count: string }>("SELECT count(*) FROM weekendcheck.x_daily_people WHERE discovery_source = 'search' AND (discovered_at AT TIME ZONE $1)::date = $2::date", [settings.timezone, day])).rows[0].count);
      let searchToken = state.search_day === day ? state.search_token : "";
      while (found < settings.discoverTarget && searchToken !== "done" && settings.searchReadCap - (await usageFor(day)).post_reads >= 10 && budget > 0) {
        const page = await reader.search(query, { token: searchToken || undefined });
        await addUsage(day, { post: page.posts.length });
        searchToken = page.next || "done";
        const byAuthor = new Map<string, FoundPost>();
        for (const post of page.posts) if (post.author_id && post.author_id !== accountId && /^\d{1,20}$/.test(post.author_id) && !byAuthor.has(post.author_id)) byAuthor.set(post.author_id, post);
        const known = new Set((await db().query<{ user_id: string }>("SELECT user_id FROM weekendcheck.x_daily_people WHERE user_id = ANY($1::text[])", [[...byAuthor.keys()]])).rows.map(row => row.user_id));
        const fresh = [...byAuthor.keys()].filter(id => !known.has(id)).slice(0, budget);
        const users = await reader.users(fresh);
        await addUsage(day, { user: users.length }); budget -= users.length;
        await saveUsers(users, now);
        for (const user of users) {
          const tier = tierOf(user.followers, settings);
          if (found >= settings.discoverTarget || !tier || !settings.discoverTiers.includes(tier)) continue;
          const post = byAuthor.get(user.id)!; const text = (post.text || "").toLowerCase();
          const keyword = settings.keywords.find(word => text.includes(word.toLowerCase())) || "";
          await db().query(`UPDATE weekendcheck.x_daily_people SET discovered_at = $2, discovery_source = 'search', discovery_keyword = $3, discovery_post_id = $4, discovery_text = $5, discovery_status = 'new'
            WHERE user_id = $1 AND first_replied_at IS NULL AND discovered_at IS NULL`, [user.id, new Date(now), keyword, /^\d{1,20}$/.test(post.id) ? post.id : null, snippet(post.text)]);
          found++; discovered++;
        }
      }
      await db().query("UPDATE weekendcheck.x_daily_state SET search_day = $1, search_token = $2 WHERE id = 1", [day, searchToken]);
    }

    await db().query("UPDATE weekendcheck.x_daily_state SET synced_at = $1, sync_finished_at = $1, sync_error = '' WHERE id = 1", [new Date(now)]);
    return { status: "synced", added, discovered };
  } catch (error) {
    const message = readerError(error);
    await db().query("UPDATE weekendcheck.x_daily_state SET sync_finished_at = $1, sync_error = $2 WHERE id = 1", [new Date(now), message]).catch(() => {});
    return { status: "error", error: message };
  }
}
