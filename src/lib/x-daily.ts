// X daily helper: settings, classification and the dashboard numbers.
// Pure functions only, so the client, the store and the tests share them.

export const tiers = ["small", "middle", "big", "star"] as const;
export type Tier = typeof tiers[number];
export const tierLabels: Record<Tier, string> = { small: "Small", middle: "Middle", big: "Big", star: "Star" };

export type XDailySettings = {
  timezone: string;
  goals: { posts: number; replies: number; newPeople: number };
  // Lower follower bounds: small is everything under `middle`.
  tiers: { middle: number; big: number; star: number };
  mix: Record<Tier, number>;
  fastMinutes: { big: number; star: number };
  quietHours: number;
  keywords: string[];
  language: string;
  discoverTiers: Tier[];
  discoverTarget: number;
  searchReadCap: number;
  lookupCap: number;
};

export const defaultXDailySettings: XDailySettings = {
  timezone: "Europe/Belgrade",
  goals: { posts: 3, replies: 50, newPeople: 10 },
  tiers: { middle: 1000, big: 10000, star: 25000 },
  mix: { small: 40, middle: 35, big: 15, star: 10 },
  fastMinutes: { big: 30, star: 10 },
  quietHours: 24,
  keywords: [],
  language: "en",
  discoverTiers: ["small", "middle", "big"],
  discoverTarget: 10,
  searchReadCap: 50,
  lookupCap: 80,
};

// X pay-per-use rates (docs.x.com/x-api/getting-started/pricing). Estimates only.
export const xRates = { ownedRead: 0.001, postRead: 0.005, userRead: 0.01 };

const integer = (value: unknown, min: number, max: number, label: string) => {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return number;
};
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function validTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); return /^[A-Za-z_+\-/0-9]{1,64}$/.test(timezone); } catch { return false; }
}

export function cleanKeywords(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]/) : [];
  const seen = new Set<string>(); const keywords: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const keyword = raw.replace(/["()]/g, "").replace(/\s+/g, " ").trim();
    if (!keyword) continue;
    if (keyword.length > 40 || !/^[\p{L}\p{N}#@$_.'\- ]+$/u.test(keyword) || /^(or|and)$/i.test(keyword)) throw new Error(`Keyword "${keyword.slice(0, 40)}" is not allowed. Use letters, numbers, #, @ and spaces, 40 characters at most.`);
    if (!seen.has(keyword.toLowerCase())) { seen.add(keyword.toLowerCase()); keywords.push(keyword); }
  }
  if (keywords.length > 15) throw new Error("Use at most 15 keywords.");
  return keywords;
}

// Saved settings are merged over the defaults so new fields get sensible values.
export function readXDailySettings(saved: unknown): XDailySettings {
  try { return validateXDailySettings({ ...defaultXDailySettings, ...record(saved) }); } catch { return { ...defaultXDailySettings }; }
}

export function validateXDailySettings(raw: unknown): XDailySettings {
  const input = record(raw); const goals = record(input.goals); const tierInput = record(input.tiers); const mixInput = record(input.mix); const fast = record(input.fastMinutes);
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  if (!validTimezone(timezone)) throw new Error("Use a timezone like Europe/Belgrade.");
  const tierBounds = { middle: integer(tierInput.middle, 1, 10_000_000, "Middle starts at"), big: integer(tierInput.big, 2, 50_000_000, "Big starts at"), star: integer(tierInput.star, 3, 500_000_000, "Star starts at") };
  if (!(tierBounds.middle < tierBounds.big && tierBounds.big < tierBounds.star)) throw new Error("Account sizes must go up: Middle < Big < Star.");
  const mix = Object.fromEntries(tiers.map(tier => [tier, integer(mixInput[tier], 0, 100, `${tierLabels[tier]} share`)])) as Record<Tier, number>;
  if (tiers.reduce((sum, tier) => sum + mix[tier], 0) !== 100) throw new Error("The reply mix must add up to 100%.");
  const language = typeof input.language === "string" ? input.language.trim().toLowerCase() : "";
  if (language && !/^[a-z]{2,3}$/.test(language)) throw new Error("Language must be a code like en, or empty for any language.");
  const discoverTiers = Array.isArray(input.discoverTiers) ? tiers.filter(tier => (input.discoverTiers as unknown[]).includes(tier)) : [];
  if (!discoverTiers.length) throw new Error("Pick at least one account size to discover.");
  return {
    timezone,
    goals: { posts: integer(goals.posts, 0, 200, "Daily posts"), replies: integer(goals.replies, 0, 1000, "Daily replies"), newPeople: integer(goals.newPeople, 0, 500, "New people") },
    tiers: tierBounds, mix,
    fastMinutes: { big: integer(fast.big, 1, 1440, "Fast reply to Big"), star: integer(fast.star, 1, 1440, "Fast reply to Star") },
    quietHours: integer(input.quietHours, 1, 336, "Quiet after"),
    keywords: cleanKeywords(input.keywords), language, discoverTiers,
    discoverTarget: integer(input.discoverTarget, 0, 50, "New accounts per day"),
    searchReadCap: integer(input.searchReadCap, 0, 500, "Search post limit"),
    lookupCap: integer(input.lookupCap, 0, 1000, "Profile lookup limit"),
  };
}

export function tierOf(followers: number | null | undefined, settings: Pick<XDailySettings, "tiers">): Tier | null {
  if (typeof followers !== "number") return null;
  if (followers >= settings.tiers.star) return "star";
  if (followers >= settings.tiers.big) return "big";
  if (followers >= settings.tiers.middle) return "middle";
  return "small";
}

// X post IDs are snowflakes: the top bits hold the creation time in ms since 2010-11-04.
export function snowflakeTime(id: string | null | undefined): number | null {
  if (!id || !/^\d{1,20}$/.test(id)) return null;
  const time = Number((BigInt(id) >> BigInt(22)) + BigInt(1288834974657));
  return time > 1288834974657 ? time : null;
}

export type TimelinePost = { id: string; created_at?: string; in_reply_to_user_id?: string; referenced_tweets?: { type: string; id: string }[]; entities?: { mentions?: { id?: string; username?: string }[] } };
export type Activity = { postId: string; createdAt: string; kind: "post" | "reply" | "thread"; repliedToUserId: string | null; repliedToPostId: string | null; repliedToUsername: string };

// Replies to yourself are thread continuations and count for neither goal. Quotes count as posts.
export function classifyPost(post: TimelinePost, accountId: string): Activity | null {
  if (!/^\d{1,20}$/.test(post.id)) return null;
  const createdAt = post.created_at && !Number.isNaN(Date.parse(post.created_at)) ? new Date(post.created_at).toISOString() : snowflakeTime(post.id) ? new Date(snowflakeTime(post.id)!).toISOString() : null;
  if (!createdAt) return null;
  const references = post.referenced_tweets || [];
  if (references.some(reference => reference.type === "retweeted")) return null;
  const parent = references.find(reference => reference.type === "replied_to");
  if (!parent) return { postId: post.id, createdAt, kind: "post", repliedToUserId: null, repliedToPostId: null, repliedToUsername: "" };
  const userId = post.in_reply_to_user_id && /^\d{1,20}$/.test(post.in_reply_to_user_id) ? post.in_reply_to_user_id : null;
  const kind = userId === accountId ? "thread" : "reply";
  const username = post.entities?.mentions?.find(mention => mention.id === userId)?.username || "";
  return { postId: post.id, createdAt, kind, repliedToUserId: kind === "reply" ? userId : null, repliedToPostId: /^\d{1,20}$/.test(parent.id) ? parent.id : null, repliedToUsername: kind === "reply" && /^\w{1,15}$/.test(username) ? username : "" };
}

export function searchQuery(settings: Pick<XDailySettings, "keywords" | "language">, ownUsername: string) {
  if (!settings.keywords.length) return "";
  const terms = settings.keywords.map(keyword => keyword.includes(" ") ? `"${keyword}"` : keyword);
  return [`(${terms.join(" OR ")})`, "-is:retweet", "-is:reply", ...(settings.language ? [`lang:${settings.language}`] : []), ...(/^\w{1,15}$/.test(ownUsername) ? [`-from:${ownUsername}`] : [])].join(" ");
}

export function localDay(time: string | number | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time));
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const shiftDay = (day: string, offset: number) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };

export type ActivityRow = { postId: string; createdAt: string; kind: "post" | "reply" | "thread"; repliedToUserId: string | null; repliedToPostId: string | null };
export type Person = {
  userId: string; username: string; name: string; followers: number | null;
  firstRepliedAt: string | null; lastRepliedAt: string | null; warm: "auto" | "pinned" | "hidden";
  discoveredAt: string | null; discoverySource: "mention" | "reply" | "search" | null; discoveryKeyword: string; discoveryPostId: string | null; discoveryText: string; discoveryStatus: "new" | "done" | "skipped" | null;
};
export type PersonView = { userId: string; username: string; name: string; followers: number | null; tier: Tier | null };
export type Quest = { id: string; label: string; detail: string; done: boolean };
export type XDailyDashboard = {
  day: string;
  goals: { posts: number; replies: number; threads: number; postGoal: number; replyGoal: number };
  quests: Quest[];
  streak: number;
  people: { unique: number; newPeople: number; topTenShare: number | null; repliesPerPerson: number | null };
  mix: { tier: Tier; count: number; share: number; target: number }[];
  unsized: number;
  speed: { tier: "big" | "star"; count: number; medianMinutes: number | null; late: number; limit: number }[];
  regulars: (PersonView & { replies: number; days: number })[];
  warm: (PersonView & { lastRepliedAt: string | null; hoursQuiet: number | null; flagged: boolean; pinned: boolean; days: number })[];
  discoveries: (PersonView & { source: "mention" | "reply" | "search"; keyword: string; postId: string | null; text: string; discoveredAt: string })[];
  week: { day: string; posts: number; replies: number; unique: number; newPeople: number; hit: boolean }[];
};

const times = (count: number) => count === 1 ? "once" : `${count} times`;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function buildDashboard(settings: XDailySettings, activity: ActivityRow[], people: Person[], now: number): XDailyDashboard {
  const zone = settings.timezone; const today = localDay(now, zone);
  const byId = new Map(people.map(person => [person.userId, person]));
  const view = (userId: string): PersonView => { const person = byId.get(userId); return { userId, username: person?.username || "", name: person?.name || "", followers: person?.followers ?? null, tier: tierOf(person?.followers, settings) }; };
  const rows = activity.map(row => ({ ...row, day: localDay(row.createdAt, zone) }));
  const firstDay = new Map(people.filter(person => person.firstRepliedAt).map(person => [person.userId, localDay(person.firstRepliedAt!, zone)]));
  const dayStats = (day: string) => {
    const items = rows.filter(row => row.day === day);
    const replies = items.filter(row => row.kind === "reply");
    const users = new Set(replies.map(row => row.repliedToUserId).filter((id): id is string => Boolean(id)));
    return { items, replies, users, posts: items.filter(row => row.kind === "post").length, newPeople: [...users].filter(id => firstDay.get(id) === day).length };
  };
  const hit = (stats: ReturnType<typeof dayStats>) => stats.posts >= settings.goals.posts && stats.replies.length >= settings.goals.replies;
  const current = dayStats(today);

  const perUser = new Map<string, number>();
  for (const reply of current.replies) if (reply.repliedToUserId) perUser.set(reply.repliedToUserId, (perUser.get(reply.repliedToUserId) || 0) + 1);
  const counted = [...perUser.values()].reduce((sum, count) => sum + count, 0);
  const topTen = [...perUser.values()].sort((a, b) => b - a).slice(0, 10).reduce((sum, count) => sum + count, 0);

  const mixCounts: Record<Tier, number> = { small: 0, middle: 0, big: 0, star: 0 }; let unsized = 0;
  for (const reply of current.replies) { const tier = reply.repliedToUserId ? view(reply.repliedToUserId).tier : null; if (tier) mixCounts[tier]++; else unsized++; }
  const sized = tiers.reduce((sum, tier) => sum + mixCounts[tier], 0);
  const mix = tiers.map(tier => ({ tier, count: mixCounts[tier], share: sized ? Math.round(mixCounts[tier] / sized * 100) : 0, target: settings.mix[tier] }));

  const speed = (["big", "star"] as const).map(tier => {
    const limit = settings.fastMinutes[tier];
    const minutes = current.replies.filter(reply => reply.repliedToUserId && view(reply.repliedToUserId).tier === tier).map(reply => {
      const parent = snowflakeTime(reply.repliedToPostId);
      return parent ? Math.max(0, (Date.parse(reply.createdAt) - parent) / 60000) : null;
    }).filter((value): value is number => value !== null);
    const middle = median(minutes);
    return { tier, count: minutes.length, medianMinutes: middle === null ? null : Math.round(middle), late: minutes.filter(value => value > limit).length, limit };
  });

  // Keep-warm list: pinned accounts plus anyone replied to on 3+ different days in 14 days.
  const recentDays = new Map<string, Set<string>>(); const weekReplies = new Map<string, number>(); const weekDays = new Map<string, Set<string>>();
  const fortnight = shiftDay(today, -13); const weekStart = shiftDay(today, -6);
  for (const row of rows) {
    if (row.kind !== "reply" || !row.repliedToUserId) continue;
    if (row.day >= fortnight) { const days = recentDays.get(row.repliedToUserId) || new Set(); days.add(row.day); recentDays.set(row.repliedToUserId, days); }
    if (row.day >= weekStart) {
      weekReplies.set(row.repliedToUserId, (weekReplies.get(row.repliedToUserId) || 0) + 1);
      const days = weekDays.get(row.repliedToUserId) || new Set(); days.add(row.day); weekDays.set(row.repliedToUserId, days);
    }
  }
  const warmIds = new Set([...people.filter(person => person.warm === "pinned").map(person => person.userId), ...[...recentDays].filter(([, days]) => days.size >= 3).map(([id]) => id)]);
  const warm = [...warmIds].filter(id => byId.get(id)?.warm !== "hidden").map(id => {
    const person = byId.get(id); const last = person?.lastRepliedAt || null;
    const hoursQuiet = last ? Math.floor((now - Date.parse(last)) / 3600000) : null;
    return { ...view(id), lastRepliedAt: last, hoursQuiet, flagged: hoursQuiet === null || hoursQuiet >= settings.quietHours, pinned: person?.warm === "pinned", days: recentDays.get(id)?.size || 0 };
  }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.hoursQuiet ?? Infinity) - (a.hoursQuiet ?? Infinity));

  const regulars = [...weekReplies].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, replies]) => ({ ...view(id), replies, days: weekDays.get(id)?.size || 0 }));
  const discoveries = people.filter(person => person.discoveryStatus === "new" && person.discoverySource && person.discoveredAt)
    .sort((a, b) => Date.parse(b.discoveredAt!) - Date.parse(a.discoveredAt!))
    .map(person => ({ ...view(person.userId), source: person.discoverySource!, keyword: person.discoveryKeyword, postId: person.discoveryPostId, text: person.discoveryText, discoveredAt: person.discoveredAt! }));

  const week = Array.from({ length: 7 }, (_, index) => { const day = shiftDay(today, index - 6); const stats = dayStats(day); return { day, posts: stats.posts, replies: stats.replies.length, unique: stats.users.size, newPeople: stats.newPeople, hit: hit(stats) }; });
  let streak = 0;
  for (let offset = hit(current) ? 0 : -1; offset > -400; offset--) { if (!hit(dayStats(shiftDay(today, offset)))) break; streak++; }

  const flagged = warm.filter(person => person.flagged).length;
  const fastReplies = speed.reduce((sum, item) => sum + item.count, 0); const lateReplies = speed.reduce((sum, item) => sum + item.late, 0);
  const mixOk = sized >= 10 && mix.every(item => Math.abs(item.share - item.target) <= 10);
  const quests: Quest[] = [
    { id: "posts", label: `Post ${times(settings.goals.posts)}`, detail: `${current.posts} of ${settings.goals.posts}`, done: current.posts >= settings.goals.posts },
    { id: "replies", label: `Reply ${times(settings.goals.replies)}`, detail: `${current.replies.length} of ${settings.goals.replies}`, done: current.replies.length >= settings.goals.replies },
    { id: "new", label: `Meet ${settings.goals.newPeople} new people`, detail: `${current.newPeople} of ${settings.goals.newPeople}`, done: current.newPeople >= settings.goals.newPeople },
    { id: "mix", label: "Keep the size mix", detail: sized < 10 ? `${sized} sized replies, need 10` : "Every size within 10 points of target", done: mixOk },
    { id: "fast", label: "Be early on Big and Star", detail: fastReplies ? `${fastReplies - lateReplies} of ${fastReplies} on time` : "No Big or Star replies yet", done: fastReplies > 0 && (fastReplies - lateReplies) / fastReplies >= 0.7 },
    { id: "warm", label: "Nobody went quiet", detail: warm.length ? flagged ? `${flagged} going quiet` : `All ${warm.length} warm` : "No warm accounts yet", done: warm.length > 0 && flagged === 0 },
  ];

  return {
    day: today,
    goals: { posts: current.posts, replies: current.replies.length, threads: current.items.filter(row => row.kind === "thread").length, postGoal: settings.goals.posts, replyGoal: settings.goals.replies },
    quests, streak,
    people: { unique: current.users.size, newPeople: current.newPeople, topTenShare: counted ? Math.round(topTen / counted * 100) : null, repliesPerPerson: current.users.size ? Math.round(current.replies.length / current.users.size * 10) / 10 : null },
    mix, unsized, speed, regulars, warm, discoveries, week,
  };
}
