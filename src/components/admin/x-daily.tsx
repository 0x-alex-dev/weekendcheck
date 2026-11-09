"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tierLabels, tiers, xRates, type PersonView, type Tier, type XDailySettings } from "@/lib/x-daily";
import type { XDailyView } from "@/lib/x-daily-store";

const STALE_MS = 10 * 60 * 1000;
const compact = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(value);
const ago = (iso: string | null, now: number) => {
  if (!iso) return "never";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
};
const profileUrl = (person: { username: string; userId: string }) => person.username ? `https://x.com/${person.username}` : `https://x.com/i/user/${person.userId}`;
const postUrl = (username: string, id: string) => `https://x.com/${username || "i"}/status/${id}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

function Handle({ person }: { person: PersonView }) {
  return <a className="xd-handle" href={profileUrl(person)} target="_blank" rel="noreferrer">
    <b>{person.username ? `@${person.username}` : "Unknown account"}</b>
    {person.name && <span>{person.name}</span>}
  </a>;
}
function Size({ person }: { person: PersonView }) {
  return person.tier ? <span className={`xd-tier ${person.tier}`}>{tierLabels[person.tier]} · {compact(person.followers!)}</span> : <span className="xd-tier">Size unknown</span>;
}
function Bar({ label, done, goal }: { label: string; done: number; goal: number }) {
  const percent = goal ? Math.min(100, Math.round(done / goal * 100)) : 100;
  return <div className={`xd-goal ${done >= goal ? "hit" : ""}`}>
    <div><span>{label}</span><strong>{done}<small> / {goal}</small></strong></div>
    <div className="xd-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={done}><i style={{ width: `${percent}%` }} /></div>
  </div>;
}

type Tab = "today" | "discover" | "people" | "settings";

export function XDaily({ view }: { view: XDailyView }) {
  const router = useRouter();
  const { dashboard: d, status, settings, usage } = view;
  const [tab, setTab] = useState<Tab>("today");
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const syncedAt = useRef(status.syncedAt);
  useEffect(() => { syncedAt.current = status.syncedAt; }, [status.syncedAt]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/admin/x-daily", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Something went wrong. Try again.");
    return result;
  }, []);
  const sync = useCallback(async () => {
    setSyncing(true); setError("");
    try { const result = await post({ action: "sync" }); if (result.status === "busy") setError("A sync just ran. Try again in a minute."); router.refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Sync failed."); router.refresh(); }
    finally { setSyncing(false); setNow(Date.now()); }
  }, [post, router]);

  // Sync when the page opens and when you come back from the X app, if the data is older than 10 minutes.
  useEffect(() => {
    if (!status.connected) return;
    const maybeSync = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      if (!syncedAt.current || Date.now() - Date.parse(syncedAt.current) > STALE_MS) void sync();
    };
    maybeSync();
    document.addEventListener("visibilitychange", maybeSync);
    return () => document.removeEventListener("visibilitychange", maybeSync);
  }, [status.connected, sync]);

  async function person(userId: string, op: string) {
    setBusy(userId + op); setError("");
    try { await post({ action: "person", userId, op }); router.refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not update."); }
    finally { setBusy(""); }
  }

  const questsDone = d.quests.filter(quest => quest.done).length;
  const flagged = d.warm.filter(item => item.flagged);
  const sizedReplies = d.mix.reduce((sum, item) => sum + item.count, 0);
  const tabs: [Tab, string, number?][] = [["today", "Today"], ["discover", "Discover", d.discoveries.length], ["people", "People", flagged.length], ["settings", "Settings"]];

  return <div className="xd">
    <div className="desk-heading xd-heading">
      <div>
        <p className="eyebrow">X DAILY · HELPER ONLY, NEVER POSTS</p>
        <h1>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</h1>
        <p>{status.account ? `@${status.account} · ` : ""}Synced {ago(status.syncedAt, now)}</p>
      </div>
      <button className="desk-button primary" disabled={!status.connected || syncing || status.syncing} onClick={() => void sync()}>{syncing || status.syncing ? "Syncing…" : "Sync now"}</button>
    </div>
    {!status.connected && <p className="desk-panel xd-alert" role="alert">X is not connected. Add <code>X_API_KEY</code>, <code>X_API_SECRET</code>, <code>X_ACCESS_TOKEN</code> and <code>X_ACCESS_TOKEN_SECRET</code> in Vercel, then redeploy.</p>}
    {(error || status.syncError) && <p className="desk-panel xd-alert" role="alert">{error || status.syncError}</p>}

    <nav className="xd-tabs" aria-label="X daily sections">{tabs.map(([id, label, count]) =>
      <button key={id} className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}{count ? <span>{count}</span> : null}</button>)}
    </nav>

    {tab === "today" && <>
      <section className="xd-score">
        <div><strong>{d.streak}</strong><span>day streak</span></div>
        <div><strong>{questsDone}<small>/{d.quests.length}</small></strong><span>{questsDone === d.quests.length ? "Perfect day" : "quests done"}</span></div>
        <div><strong>{d.people.unique}</strong><span>people today</span></div>
      </section>
      <section className="desk-panel">
        <Bar label="Posts" done={d.goals.posts} goal={d.goals.postGoal} />
        <Bar label="Replies" done={d.goals.replies} goal={d.goals.replyGoal} />
        {d.goals.threads > 0 && <small>{d.goals.threads} thread {d.goals.threads === 1 ? "reply" : "replies"} to yourself not counted.</small>}
      </section>
      <section className="desk-panel">
        <h2>Quests</h2>
        <ul className="xd-quests">{d.quests.map(quest => <li key={quest.id} className={quest.done ? "done" : ""}><i aria-hidden="true">{quest.done ? "✓" : ""}</i><div><b>{quest.label}</b><small>{quest.detail}</small></div></li>)}</ul>
      </section>
      <section className="desk-panel">
        <h2>Who you talked to</h2>
        <div className="xd-stats">
          <div><strong>{d.people.unique}</strong><span>unique people</span></div>
          <div><strong>{d.people.newPeople}</strong><span>new people</span></div>
          <div><strong>{d.people.repliesPerPerson ?? "–"}</strong><span>replies per person</span></div>
          <div><strong>{d.people.topTenShare === null ? "–" : `${d.people.topTenShare}%`}</strong><span>went to your top 10</span></div>
        </div>
        {status.trackingSince && <small>&ldquo;New&rdquo; means first reply since tracking started {new Date(status.trackingSince).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. It gets more accurate every day.</small>}
      </section>
      {flagged.length > 0 && <section className="desk-panel">
        <div className="desk-section-heading"><h2>Going quiet</h2><button className="desk-link-button" onClick={() => setTab("people")}>See all</button></div>
        {flagged.slice(0, 5).map(item => <div className="xd-row" key={item.userId}><div className="desk-grow"><Handle person={item} /><small>{item.hoursQuiet === null ? "No reply yet" : `Last reply ${item.hoursQuiet} h ago`}</small></div><Size person={item} /></div>)}
      </section>}
      <section className="desk-panel">
        <h2>Size mix</h2>
        <p className="desk-hint">Small: give attention. Middle: build trust. Big and Star: reply fast.</p>
        {d.mix.map(item => <div className="xd-mix" key={item.tier}>
          <span>{tierLabels[item.tier]}</span>
          <div className="xd-track"><i className={item.tier} style={{ width: `${item.share}%` }} /><em style={{ left: `${item.target}%` }} title={`Target ${item.target}%`} /></div>
          <b>{item.count} <small>{item.share}% / {item.target}%</small></b>
        </div>)}
        <small>{sizedReplies} sized replies{d.unsized ? `, ${d.unsized} waiting for a size lookup` : ""}. The line marks your target.</small>
        <div className="xd-speed">{d.speed.map(item => <div key={item.tier}>
          <b>{tierLabels[item.tier]}</b>
          <span>{item.count ? `Median ${item.medianMinutes} min · ${item.late} late (over ${item.limit} min)` : `No replies yet · aim for under ${item.limit} min`}</span>
        </div>)}</div>
      </section>
      <section className="desk-panel">
        <h2>Last 7 days</h2>
        <div className="xd-week">{d.week.map(day => <div key={day.day} className={`${day.hit ? "hit" : ""} ${day.day === d.day ? "today" : ""}`}>
          <span>{dayLabel(day.day)}</span><strong>{day.replies}</strong><small>{plural(day.posts, "post")}</small><small>{day.unique} {day.unique === 1 ? "person" : "people"}</small><small>{day.newPeople} new</small>
        </div>)}</div>
      </section>
    </>}

    {tab === "discover" && <>
      <p className="desk-hint xd-intro">People who replied to or mentioned you but you never replied to, plus up to {settings.discoverTarget} new accounts a day from your keywords. Mark them once you&apos;ve replied, or skip to hide them.</p>
      {!settings.keywords.length && <p className="desk-panel xd-alert">Add niche keywords in Settings to get new accounts from search.</p>}
      {!d.discoveries.length && <section className="desk-panel desk-empty"><p>No new accounts right now. They show up after the next sync.</p></section>}
      {d.discoveries.map(item => <article className="desk-panel xd-card" key={item.userId}>
        <header><Handle person={item} /><Size person={item} /></header>
        <small>{item.source === "reply" ? "Replied to you" : item.source === "mention" ? "Mentioned you" : `Keyword${item.keyword ? `: ${item.keyword}` : " search"}`} · {ago(item.discoveredAt, now)}</small>
        {item.text && <p>{item.text}</p>}
        <div className="xd-actions">
          {item.postId && <a className="desk-button primary" href={postUrl(item.username, item.postId)} target="_blank" rel="noreferrer">Open post</a>}
          <button className="desk-button" disabled={Boolean(busy)} onClick={() => void person(item.userId, "done")}>Replied</button>
          <button className="desk-button" disabled={Boolean(busy)} onClick={() => void person(item.userId, "pin")}>Keep warm</button>
          <button className="desk-link-button" disabled={Boolean(busy)} onClick={() => void person(item.userId, "skip")}>Skip</button>
        </div>
      </article>)}
    </>}

    {tab === "people" && <>
      <section className="desk-panel">
        <h2>Keep warm</h2>
        <p className="desk-hint">Anyone you replied to on 3+ days in the last 2 weeks, plus accounts you pinned. Flagged after {settings.quietHours} h without a reply.</p>
        {!d.warm.length && <p className="desk-hint">Nobody yet. Keep replying, or pin accounts from Discover.</p>}
        {d.warm.map(item => <div className={`xd-row ${item.flagged ? "flagged" : ""}`} key={item.userId}>
          <div className="desk-grow"><Handle person={item} /><small>{item.flagged ? "Going quiet · " : ""}{item.hoursQuiet === null ? "No reply yet" : `Last reply ${item.hoursQuiet} h ago`} · {plural(item.days, "day")} in 2 weeks{item.pinned ? " · pinned" : ""}</small></div>
          <Size person={item} />
          <div className="xd-row-actions">
            {item.pinned ? <button className="desk-link-button" disabled={Boolean(busy)} onClick={() => void person(item.userId, "unpin")}>Unpin</button>
              : <button className="desk-link-button" disabled={Boolean(busy)} onClick={() => void person(item.userId, "pin")}>Pin</button>}
            <button className="desk-link-button danger" disabled={Boolean(busy)} onClick={() => void person(item.userId, "hide")}>Hide</button>
          </div>
        </div>)}
      </section>
      <section className="desk-panel">
        <h2>Your regulars this week</h2>
        <p className="desk-hint">Who gets most of your replies. If the same names fill this every week, you&apos;re in a loop.</p>
        {!d.regulars.length && <p className="desk-hint">No replies in the last 7 days.</p>}
        {d.regulars.map((item, index) => <div className="xd-row" key={item.userId}>
          <span className="xd-rank">{index + 1}</span>
          <div className="desk-grow"><Handle person={item} /><small>{item.replies === 1 ? "1 reply" : `${item.replies} replies`} on {plural(item.days, "day")}</small></div>
          <Size person={item} />
        </div>)}
      </section>
    </>}

    {tab === "settings" && <SettingsForm settings={settings} onSave={async next => { await post({ action: "settings", settings: next }); router.refresh(); }} />}

    <p className="xd-cost">X API cost estimate: ${usage.todayCost.toFixed(2)} today · ${usage.monthCost.toFixed(2)} this month. Your real bill is at console.x.com.</p>
  </div>;
}

function SettingsForm({ settings, onSave }: { settings: XDailySettings; onSave: (settings: unknown) => Promise<void> }) {
  const [form, setForm] = useState(() => ({ ...settings, keywordsText: settings.keywords.join("\n") }));
  const [message, setMessage] = useState(""); const [failed, setFailed] = useState(false); const [saving, setSaving] = useState(false);
  const number = (value: string) => value === "" ? ("" as unknown as number) : Number(value);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(current => ({ ...current, [key]: value }));
  const mixTotal = tiers.reduce((sum, tier) => sum + (Number(form.mix[tier]) || 0), 0);
  const maxDaily = (Number(form.searchReadCap) || 0) * xRates.postRead + (Number(form.lookupCap) || 0) * xRates.userRead;
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(""); setFailed(false);
    const { keywordsText, ...rest } = form;
    try { await onSave({ ...rest, keywords: keywordsText }); setMessage("Saved."); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save."); }
    finally { setSaving(false); }
  }
  const field = (label: string, value: number, change: (value: number) => void, hint?: string) =>
    <label>{label}<input type="number" inputMode="numeric" min={0} value={value} onChange={event => change(number(event.target.value))} />{hint && <small>{hint}</small>}</label>;
  return <form className="desk-panel xd-settings" onSubmit={save}>
    <h2>Daily goals</h2>
    <div className="xd-fields">
      {field("Posts", form.goals.posts, value => set("goals", { ...form.goals, posts: value }))}
      {field("Replies", form.goals.replies, value => set("goals", { ...form.goals, replies: value }))}
      {field("New people", form.goals.newPeople, value => set("goals", { ...form.goals, newPeople: value }))}
    </div>
    <label>Timezone (your day starts at midnight here)<input value={form.timezone} onChange={event => set("timezone", event.target.value)} autoCapitalize="off" autoCorrect="off" /></label>

    <h2>Account sizes</h2>
    <p className="desk-hint">Followers where each size starts. Small is everything under Middle.</p>
    <div className="xd-fields">
      {field("Middle from", form.tiers.middle, value => set("tiers", { ...form.tiers, middle: value }))}
      {field("Big from", form.tiers.big, value => set("tiers", { ...form.tiers, big: value }))}
      {field("Star from", form.tiers.star, value => set("tiers", { ...form.tiers, star: value }))}
    </div>
    <h2>Reply mix target</h2>
    <div className="xd-fields four">{tiers.map(tier => <label key={tier}>{tierLabels[tier]} %<input type="number" inputMode="numeric" min={0} max={100} value={form.mix[tier]} onChange={event => set("mix", { ...form.mix, [tier]: number(event.target.value) })} /></label>)}</div>
    <small className={mixTotal === 100 ? "" : "desk-warning"}>Total {mixTotal}%{mixTotal === 100 ? "" : " (must be 100%)"}</small>
    <div className="xd-fields">
      {field("Fast reply to Big (min)", form.fastMinutes.big, value => set("fastMinutes", { ...form.fastMinutes, big: value }))}
      {field("Fast reply to Star (min)", form.fastMinutes.star, value => set("fastMinutes", { ...form.fastMinutes, star: value }))}
      {field("Flag warm account after (h)", form.quietHours, value => set("quietHours", value))}
    </div>

    <h2>Discovery</h2>
    <label>Niche keywords, one per line<textarea rows={5} value={form.keywordsText} onChange={event => set("keywordsText", event.target.value)} placeholder={"buildinpublic\nindie hacker\nvibe coding"} autoCapitalize="off" /></label>
    <label>Language code (empty for any)<input value={form.language} onChange={event => set("language", event.target.value)} maxLength={3} autoCapitalize="off" /></label>
    <fieldset className="xd-checks"><legend>Suggest these sizes</legend>{tiers.map(tier => <label className="desk-check" key={tier}>
      <input type="checkbox" checked={form.discoverTiers.includes(tier)} onChange={event => set("discoverTiers", event.target.checked ? tiers.filter(t => t === tier || form.discoverTiers.includes(t)) : form.discoverTiers.filter(t => t !== tier) as Tier[])} />{tierLabels[tier]}
    </label>)}</fieldset>
    <div className="xd-fields">
      {field("New accounts per day", form.discoverTarget, value => set("discoverTarget", value))}
      {field("Max search posts per day", form.searchReadCap, value => set("searchReadCap", value), "$0.005 each, read 10 at a time")}
      {field("Max profile lookups per day", form.lookupCap, value => set("lookupCap", value), "$0.01 each, for follower counts")}
    </div>
    <p className="desk-hint">Worst case with these limits: about ${(maxDaily + 0.2).toFixed(2)} a day. Reading your own posts and mentions costs about $0.001 each.</p>
    <div className="desk-form-actions"><button className="desk-button primary" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>{message && <small className={failed ? "desk-error" : ""} role={failed ? "alert" : "status"}>{message}</small>}</div>
  </form>;
}
