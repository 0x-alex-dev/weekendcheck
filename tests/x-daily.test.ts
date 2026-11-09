import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { closeDatabase, database } from "../src/lib/database";
import { buildDashboard, classifyPost, cleanKeywords, defaultXDailySettings, searchQuery, snowflakeTime, tierOf, validateXDailySettings, type ActivityRow, type Person, type XDailySettings } from "../src/lib/x-daily";
import { readXDaily, saveXDailySettings, syncXDaily, updateXDailyPerson } from "../src/lib/x-daily-store";
import type { FoundPost, XReader, XUser } from "../src/lib/x-daily-reader";
import type { TimelinePost } from "../src/lib/x-daily";

after(closeDatabase);
const ME = "100";
const EPOCH = BigInt(1288834974657);
const idAt = (time: number, sequence = 0) => ((BigInt(time) - EPOCH << BigInt(22)) + BigInt(sequence)).toString();
const NOW = Date.parse("2026-11-09T18:00:00Z"); // 19:00 in Belgrade
const minutes = (n: number) => n * 60000;
const settings: XDailySettings = { ...defaultXDailySettings, goals: { posts: 1, replies: 3, newPeople: 2 } };

const person = (userId: string, followers: number | null, extra: Partial<Person> = {}): Person => ({
  userId, username: `user${userId}`, name: "", followers, firstRepliedAt: null, lastRepliedAt: null, warm: "auto",
  discoveredAt: null, discoverySource: null, discoveryKeyword: "", discoveryPostId: null, discoveryText: "", discoveryStatus: null, ...extra,
});
const reply = (time: number, userId: string, parentTime = time - minutes(5)): ActivityRow => ({ postId: idAt(time), createdAt: new Date(time).toISOString(), kind: "reply", repliedToUserId: userId, repliedToPostId: idAt(parentTime) });
const ownPost = (time: number): ActivityRow => ({ postId: idAt(time), createdAt: new Date(time).toISOString(), kind: "post", repliedToUserId: null, repliedToPostId: null });

test("snowflake ids carry their creation time", () => {
  assert.equal(snowflakeTime(idAt(NOW)), NOW);
  assert.equal(snowflakeTime("abc"), null);
});

test("posts are classified as post, reply or thread and reposts are ignored", () => {
  const time = new Date(NOW).toISOString();
  const replyPost: TimelinePost = { id: "1", created_at: time, in_reply_to_user_id: "7", referenced_tweets: [{ type: "replied_to", id: "2" }], entities: { mentions: [{ id: "7", username: "maker" }] } };
  assert.deepEqual(classifyPost(replyPost, ME), { postId: "1", createdAt: time, kind: "reply", repliedToUserId: "7", repliedToPostId: "2", repliedToUsername: "maker" });
  assert.equal(classifyPost({ ...replyPost, in_reply_to_user_id: ME }, ME)?.kind, "thread");
  assert.equal(classifyPost({ ...replyPost, in_reply_to_user_id: ME }, ME)?.repliedToUserId, null);
  assert.equal(classifyPost({ id: "3", created_at: time, referenced_tweets: [{ type: "quoted", id: "4" }] }, ME)?.kind, "post");
  assert.equal(classifyPost({ id: "5", created_at: time }, ME)?.kind, "post");
  assert.equal(classifyPost({ id: "6", created_at: time, referenced_tweets: [{ type: "retweeted", id: "4" }] }, ME), null);
});

test("settings are validated and tiers follow the follower bounds", () => {
  assert.equal(tierOf(999, settings), "small");
  assert.equal(tierOf(1000, settings), "middle");
  assert.equal(tierOf(10000, settings), "big");
  assert.equal(tierOf(25000, settings), "star");
  assert.equal(tierOf(null, settings), null);
  assert.throws(() => validateXDailySettings({ ...settings, mix: { small: 50, middle: 50, big: 10, star: 0 } }), /100%/);
  assert.throws(() => validateXDailySettings({ ...settings, tiers: { middle: 10000, big: 1000, star: 25000 } }), /go up/);
  assert.throws(() => validateXDailySettings({ ...settings, timezone: "Mars/Base" }), /timezone/);
  assert.throws(() => validateXDailySettings({ ...settings, discoverTiers: [] }), /at least one/);
  assert.deepEqual(cleanKeywords("buildinpublic\n\"indie hacker\", BuildInPublic\n"), ["buildinpublic", "indie hacker"]);
  assert.throws(() => cleanKeywords(["a:b"]), /not allowed/);
  assert.equal(validateXDailySettings({ ...settings, goals: { posts: "4", replies: 3, newPeople: 2 } }).goals.posts, 4);
});

test("search query uses keywords, skips replies and reposts, and excludes your own posts", () => {
  assert.equal(searchQuery({ keywords: ["buildinpublic", "indie hacker"], language: "en" }, "0xAlex_dev"), '(buildinpublic OR "indie hacker") -is:retweet -is:reply lang:en -from:0xAlex_dev');
  assert.equal(searchQuery({ keywords: [], language: "en" }, "me"), "");
});

test("dashboard counts goals, unique and new people, size mix, speed, warm list and streak", () => {
  const today = NOW - minutes(60);
  const activity = [
    ownPost(today), reply(today + 1000, "1"), reply(today + 2000, "1"), reply(today + 3000, "2", today - minutes(45)), reply(today + 4000, "3", today - minutes(2)),
    { ...reply(today + 5000, ME), kind: "thread" as const, repliedToUserId: null },
    // Yesterday and the day before: goals hit, and person 1 replied to on 3 different days.
    ownPost(NOW - 86400000), reply(NOW - 86400000 + 1, "1"), reply(NOW - 86400000 + 2, "4"), reply(NOW - 86400000 + 3, "4"),
    ownPost(NOW - 2 * 86400000), reply(NOW - 2 * 86400000 + 1, "1"), reply(NOW - 2 * 86400000 + 2, "5"), reply(NOW - 2 * 86400000 + 3, "5"),
  ];
  const people = [
    person("1", 500, { firstRepliedAt: new Date(NOW - 2 * 86400000).toISOString(), lastRepliedAt: new Date(today + 2000).toISOString() }),
    person("2", 12000, { firstRepliedAt: new Date(today + 3000).toISOString(), lastRepliedAt: new Date(today + 3000).toISOString() }),
    person("3", 30000, { firstRepliedAt: new Date(today + 4000).toISOString(), lastRepliedAt: new Date(today + 4000).toISOString() }),
    person("9", 2000, { warm: "pinned", lastRepliedAt: new Date(NOW - 30 * 3600000).toISOString() }),
    person("8", 50, { discoveredAt: new Date(NOW).toISOString(), discoverySource: "search", discoveryStatus: "new", discoveryPostId: "55", discoveryText: "shipped" }),
  ];
  const d = buildDashboard(settings, activity, people, NOW);
  assert.equal(d.day, "2026-11-09");
  assert.deepEqual(d.goals, { posts: 1, replies: 4, threads: 1, postGoal: 1, replyGoal: 3 });
  assert.deepEqual(d.people, { unique: 3, newPeople: 2, topTenShare: 100, repliesPerPerson: 1.3 });
  assert.deepEqual(d.mix.map(item => item.count), [2, 0, 1, 1]);
  assert.equal(d.speed.find(item => item.tier === "big")?.late, 1);
  assert.equal(d.speed.find(item => item.tier === "star")?.medianMinutes, 2);
  assert.equal(d.streak, 3);
  assert.deepEqual(d.warm.map(item => [item.userId, item.flagged]), [["9", true], ["1", false]]);
  assert.equal(d.regulars[0].userId, "1"); assert.equal(d.regulars[0].replies, 4);
  assert.equal(d.discoveries.length, 1);
  assert.deepEqual(d.quests.filter(quest => quest.done).map(quest => quest.id), ["posts", "replies", "new"]);
});

// Fake X: records calls and serves canned pages, so no real API is used.
function fakeReader(data: { timeline?: TimelinePost[][]; mentions?: FoundPost[]; search?: FoundPost[][]; users?: Record<string, number> }) {
  const calls: { name: string; args: unknown }[] = [];
  let searchPage = 0; let timelinePage = 0;
  const reader: XReader = {
    async me() { calls.push({ name: "me", args: null }); return { id: ME, username: "me_dev" }; },
    async timeline(_id, options) {
      calls.push({ name: "timeline", args: options });
      const pages = data.timeline || [[]]; const posts = pages[timelinePage] || [];
      timelinePage++;
      return { posts, newestId: posts[0]?.id, next: timelinePage < pages.length ? `t${timelinePage}` : undefined };
    },
    async mentions(_id, options) { calls.push({ name: "mentions", args: options }); const posts = data.mentions || []; data.mentions = []; return { posts, newestId: posts[0]?.id }; },
    async search(query, options) { calls.push({ name: "search", args: { query, ...options } }); const pages = data.search || []; const posts = pages[searchPage] || []; searchPage++; return { posts, next: searchPage < pages.length ? `s${searchPage}` : undefined }; },
    async users(ids) { calls.push({ name: "users", args: ids }); return ids.map((id): XUser => ({ id, username: `u${id}`, name: `User ${id}`, followers: data.users?.[id] ?? 100 })); },
  };
  return { reader, calls };
}
async function reset(saved: Partial<XDailySettings> = {}) {
  await database().query("TRUNCATE weekendcheck.x_daily_activity, weekendcheck.x_daily_people, weekendcheck.x_daily_usage");
  await database().query("UPDATE weekendcheck.x_daily_state SET settings = $1::jsonb, account_id = NULL, account_username = '', newest_post_id = NULL, newest_mention_id = NULL, tracking_since = NULL, search_day = '', search_token = '', sync_started_at = NULL, sync_finished_at = NULL, synced_at = NULL, sync_error = '' WHERE id = 1", [JSON.stringify({ ...defaultXDailySettings, ...saved })]);
}
beforeEach(() => reset());

const timelineReply = (time: number, userId: string, username: string): TimelinePost => ({ id: idAt(time), created_at: new Date(time).toISOString(), in_reply_to_user_id: userId, referenced_tweets: [{ type: "replied_to", id: idAt(time - minutes(3)) }], entities: { mentions: [{ id: userId, username }] } });

test("first sync backfills a week, sizes people, and suggests people who mentioned you", async () => {
  const { reader, calls } = fakeReader({
    timeline: [[timelineReply(NOW - minutes(10), "7", "seven"), timelineReply(NOW - minutes(20), "7", "seven")], [{ id: idAt(NOW - minutes(30)), created_at: new Date(NOW - minutes(30)).toISOString() }]],
    mentions: [
      { id: idAt(NOW - minutes(5)), author_id: "7", text: "already a friend" },
      { id: idAt(NOW - minutes(6)), author_id: "8", text: "nice post", in_reply_to_user_id: ME, referenced_tweets: [{ type: "replied_to", id: "1" }] },
      { id: idAt(NOW - minutes(7)), author_id: ME, text: "me" },
    ],
    users: { "7": 12000, "8": 300 },
  });
  const result = await syncXDaily(reader, NOW);
  assert.deepEqual(result, { status: "synced", added: 3, discovered: 1 });
  assert.equal((calls.find(call => call.name === "timeline")!.args as { startTime?: string }).startTime, new Date(NOW - 7 * 86400000).toISOString());
  assert.deepEqual(calls.find(call => call.name === "users")!.args, ["8", "7"]);
  assert.equal(calls.some(call => call.name === "search"), false, "no keywords means no search spend");
  const view = await readXDaily(NOW);
  assert.equal(view.status.account, "me_dev");
  assert.deepEqual([view.dashboard.goals.posts, view.dashboard.goals.replies, view.dashboard.people.unique], [1, 2, 1]);
  assert.equal(view.dashboard.mix.find(item => item.tier === "big")?.count, 2);
  assert.deepEqual(view.dashboard.discoveries.map(item => [item.userId, item.source, item.username, item.tier]), [["8", "reply", "u8", "small"]]);
  assert.deepEqual(view.usage.today, { ownedReads: 6, postReads: 0, userReads: 3 });
  assert.equal(view.usage.todayCost.toFixed(3), "0.036");

  // A second sync within a minute is refused; later ones continue from the newest post.
  assert.deepEqual(await syncXDaily(reader, NOW + 1000), { status: "busy" });
  const next = fakeReader({ timeline: [[timelineReply(NOW + minutes(1), "8", "u8")]] });
  assert.equal((await syncXDaily(next.reader, NOW + minutes(2))).status, "synced");
  assert.equal((next.calls.find(call => call.name === "timeline")!.args as { sinceId?: string }).sinceId, idAt(NOW - minutes(10)));
  assert.equal(next.calls.some(call => call.name === "me"), false);
  // Replying to a suggested account clears it from Discover.
  assert.equal((await readXDaily(NOW + minutes(2))).dashboard.discoveries.length, 0);
});

test("keyword discovery stops at the daily target and respects size filters and caps", async () => {
  await reset({ keywords: ["buildinpublic"], discoverTarget: 2, discoverTiers: ["small", "middle"], searchReadCap: 50 });
  const page = (start: number) => Array.from({ length: 10 }, (_, index) => ({ id: idAt(NOW - minutes(start + index)), author_id: String(200 + start + index), text: "Day 3 of #BuildInPublic" }));
  const { reader, calls } = fakeReader({ search: [page(0), page(10), page(20)], users: { "200": 90000, "201": 500, "202": 4000, "203": 800 } });
  const result = await syncXDaily(reader, NOW);
  assert.equal(result.discovered, 2);
  assert.equal(calls.filter(call => call.name === "search").length, 1, "one page of 10 was enough");
  const view = await readXDaily(NOW);
  assert.deepEqual(view.dashboard.discoveries.map(item => item.userId).sort(), ["201", "202"]);
  assert.equal(view.dashboard.discoveries[0].keyword, "buildinpublic");
  assert.equal(view.usage.today.postReads, 10);

  // Later the same day: target met, so no more search spend.
  const again = fakeReader({ search: [page(30)] });
  await syncXDaily(again.reader, NOW + minutes(5));
  assert.equal(again.calls.some(call => call.name === "search"), false);

  // Skipped accounts stay hidden; accounts already looked up are never suggested again.
  await updateXDailyPerson("201", "skip");
  assert.deepEqual((await readXDaily(NOW)).dashboard.discoveries.map(item => item.userId), ["202"]);
  await assert.rejects(updateXDailyPerson("201", "delete"), /Unknown action/);
});

test("search stops at the post read cap", async () => {
  await reset({ keywords: ["shipped"], discoverTarget: 10, searchReadCap: 20 });
  const page = (start: number) => Array.from({ length: 10 }, (_, index) => ({ id: idAt(NOW - minutes(start + index)), author_id: String(300 + start + index), text: "shipped" }));
  const { reader, calls } = fakeReader({ search: [page(0), page(10), page(20), page(30)], users: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [String(300 + index), 99999])) });
  await syncXDaily(reader, NOW);
  assert.equal(calls.filter(call => call.name === "search").length, 2);
  assert.equal((await readXDaily(NOW)).usage.today.postReads, 20);
});

test("X errors are stored for the page and release the sync", async () => {
  const { reader } = fakeReader({});
  reader.timeline = async () => { throw new Error("X is down"); };
  assert.deepEqual(await syncXDaily(reader, NOW), { status: "error", error: "X is down" });
  const view = await readXDaily(NOW);
  assert.equal(view.status.syncError, "X is down");
  assert.equal(view.status.syncing, false);
  assert.equal(view.status.syncedAt, null);
});

test("settings are saved only when valid", async () => {
  await assert.rejects(saveXDailySettings({ ...defaultXDailySettings, mix: { small: 90, middle: 90, big: 0, star: 0 } }), /100%/);
  await saveXDailySettings({ ...defaultXDailySettings, keywords: "indie hacker\nshipped" });
  assert.deepEqual((await readXDaily(NOW)).settings.keywords, ["indie hacker", "shipped"]);
});
