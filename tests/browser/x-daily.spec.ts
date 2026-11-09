import { expect, test } from "@playwright/test";
import { closeDatabase, database } from "../../src/lib/database";

const EPOCH = BigInt(1288834974657);
const idAt = (time: number) => ((BigInt(time) - EPOCH) << BigInt(22)).toString();
const shots = process.env.WEEKENDCHECK_SHOTS;

test.afterAll(closeDatabase);
test.beforeAll(async () => {
  const db = database(); const now = Date.now(); const hour = 3600000;
  await db.query("TRUNCATE weekendcheck.x_daily_activity, weekendcheck.x_daily_people, weekendcheck.x_daily_usage");
  await db.query("UPDATE weekendcheck.x_daily_state SET account_username = 'browser_dev', synced_at = now(), tracking_since = now() - interval '7 days', settings = $1::jsonb WHERE id = 1",
    [JSON.stringify({ timezone: "UTC", goals: { posts: 1, replies: 6, newPeople: 3 }, keywords: ["buildinpublic"] })]);
  const people: [string, string, number, number][] = [["11", "small_maker", 420, 30], ["12", "mid_builder", 4200, 10], ["13", "big_founder", 18000, 2], ["14", "star_account", 90000, 1], ["15", "regular_friend", 800, 40]];
  for (const [id, username, followers, firstDaysAgo] of people)
    await db.query("INSERT INTO weekendcheck.x_daily_people(user_id, username, name, followers, followers_checked_at, first_replied_at, last_replied_at) VALUES ($1, $2, $3, $4, now(), now() - $5 * interval '1 day', now() - interval '1 hour')", [id, username, username.replace("_", " "), followers, firstDaysAgo]);
  await db.query("INSERT INTO weekendcheck.x_daily_people(user_id, username, name, followers, warm, last_replied_at) VALUES ('16', 'quiet_pal', 'Quiet Pal', 2600, 'pinned', now() - interval '30 hours')");
  await db.query("INSERT INTO weekendcheck.x_daily_people(user_id, username, name, followers, discovered_at, discovery_source, discovery_keyword, discovery_post_id, discovery_text, discovery_status) VALUES ('17', 'new_face', 'New Face', 650, now(), 'search', 'buildinpublic', '1850000000000000000', 'Day 12 of #buildinpublic: shipped onboarding and got our first paying user.', 'new'), ('18', 'fan_reply', 'Fan Reply', 1300, now(), 'reply', '', '1850000000000000001', 'This is great, how did you find the first users?', 'new')");
  const rows: [number, string, string | null][] = [[0.2, "post", null], [0.3, "reply", "11"], [0.4, "reply", "11"], [0.5, "reply", "12"], [0.6, "reply", "13"], [0.7, "reply", "14"], [0.8, "reply", "15"], [24, "reply", "15"], [48, "reply", "15"], [24.1, "post", null], [48.1, "post", null]];
  for (const [hoursAgo, kind, user] of rows) {
    const time = now - hoursAgo * hour;
    await db.query("INSERT INTO weekendcheck.x_daily_activity(post_id, created_at, kind, replied_to_user_id, replied_to_post_id) VALUES ($1, $2, $3, $4, $5)", [idAt(time), new Date(time), kind, user, user ? idAt(time - 20 * 60000) : null]);
  }
});

for (const [name, viewport] of [["mobile", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 900 }]] as const) {
  test(`X daily page works on ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/admin/x-daily");
    await expect(page.getByText("X is not connected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled();
    await expect(page.getByRole("progressbar", { name: "Replies" })).toHaveAttribute("aria-valuenow", "6");
    await expect(page.locator(".xd-quests li.done")).toHaveCount(2);
    await expect(page.locator(".xd-score")).toContainText("day streak");
    await expect(page.getByRole("heading", { name: "Going quiet" })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/x-daily-${name}-today.png`, fullPage: true });

    await page.getByRole("button", { name: /^Discover/ }).click();
    await expect(page.getByText("@new_face")).toBeVisible();
    await expect(page.getByText("Replied to you")).toBeVisible();
    await expect(page.locator(".xd-card").filter({ hasText: "@new_face" }).getByRole("link", { name: "Open post" })).toHaveAttribute("href", /x\.com\/new_face\/status\/1850000000000000000/);
    if (shots) await page.screenshot({ path: `${shots}/x-daily-${name}-discover.png`, fullPage: true });

    await page.getByRole("button", { name: /^People/ }).click();
    await expect(page.locator(".xd-row.flagged")).toContainText("@quiet_pal");
    await expect(page.getByText("Your regulars this week")).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/x-daily-${name}-people.png`, fullPage: true });

    await page.getByRole("button", { name: "Settings" }).click();
    if (shots) await page.screenshot({ path: `${shots}/x-daily-${name}-settings.png`, fullPage: true });
  });
}

test("discover actions and settings validation", async ({ page }) => {
  await page.goto("/admin/x-daily");
  await page.getByRole("button", { name: /^Discover/ }).click();
  await page.locator(".xd-card").filter({ hasText: "@fan_reply" }).getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("@fan_reply")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /^Discover/ }).click();
  await expect(page.getByText("@fan_reply")).toHaveCount(0);
  await expect(page.getByText("@new_face")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Small %").fill("90");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "100%" })).toBeVisible();
  await page.getByLabel("Small %").fill("40");
  await page.getByLabel("Replies", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("progressbar", { name: "Replies" })).toHaveAttribute("aria-valuemax", "100");
});
