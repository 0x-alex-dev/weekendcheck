import { ApiResponseError, TwitterApi } from "twitter-api-v2";
import type { TimelinePost } from "./x-daily";
import { xWriteConfigured } from "./x-publisher";

// Read-only X access for the daily helper. It only calls GET endpoints: nothing is posted, liked or followed.
export type XUser = { id: string; username: string; name: string; followers: number | null };
export type FoundPost = TimelinePost & { author_id?: string; text?: string };
export type Page<T> = { posts: T[]; next?: string; newestId?: string };
export type XReader = {
  me: () => Promise<{ id: string; username: string }>;
  timeline: (userId: string, options: { sinceId?: string; startTime?: string; token?: string }) => Promise<Page<TimelinePost>>;
  mentions: (userId: string, options: { sinceId?: string; startTime?: string; token?: string }) => Promise<Page<FoundPost>>;
  search: (query: string, options: { token?: string }) => Promise<Page<FoundPost>>;
  users: (ids: string[]) => Promise<XUser[]>;
};

export const xReadConfigured = xWriteConfigured;

export function readerError(error: unknown) {
  if (!(error instanceof ApiResponseError)) return error instanceof Error && error.message.startsWith("X ") ? error.message : "X could not be reached. Try again in a minute.";
  if (error.code === 401) return "X rejected the API keys. Check the X credentials in Vercel.";
  if (error.code === 402) return "The X developer account is out of credits. Top up at console.x.com.";
  if (error.code === 403) return "X refused the read. Check that the app has pay-per-use credits and Read access.";
  if (error.code === 429) return "X rate limit reached. Try again in 15 minutes.";
  return `X returned an error (HTTP ${error.code}). Try again later.`;
}

const timelineFields = { "tweet.fields": "created_at,referenced_tweets,in_reply_to_user_id,entities", max_results: 100 } as const;
type Response<T> = { data?: T[]; meta?: { next_token?: string; newest_id?: string } };
const page = <T,>(result: Response<T>): Page<T> => ({ posts: result.data || [], next: result.meta?.next_token, newestId: result.meta?.newest_id });

export function createXReader(): XReader {
  if (!xReadConfigured()) throw new Error("X is not connected. Add the X API keys in Vercel.");
  const client = new TwitterApi({ appKey: process.env.X_API_KEY!, appSecret: process.env.X_API_SECRET!, accessToken: process.env.X_ACCESS_TOKEN!, accessSecret: process.env.X_ACCESS_TOKEN_SECRET! });
  const get = <T,>(path: string, query: Record<string, string | number>) => client.v2.get<T>(path, query, { timeout: 20000 });
  const window = (options: { sinceId?: string; startTime?: string; token?: string }) => ({
    ...(options.sinceId ? { since_id: options.sinceId } : options.startTime ? { start_time: options.startTime } : {}),
    ...(options.token ? { pagination_token: options.token } : {}),
  });
  return {
    async me() { const result = await get<{ data: { id: string; username: string } }>("users/me", {}); return { id: result.data.id, username: result.data.username }; },
    async timeline(userId, options) { return page(await get<Response<TimelinePost>>(`users/${userId}/tweets`, { ...timelineFields, exclude: "retweets", ...window(options) })); },
    async mentions(userId, options) { return page(await get<Response<FoundPost>>(`users/${userId}/mentions`, { ...timelineFields, "tweet.fields": `${timelineFields["tweet.fields"]},author_id,text`, ...window(options) })); },
    async search(query, options) {
      return page(await get<Response<FoundPost>>("tweets/search/recent", { query, max_results: 10, "tweet.fields": "author_id,text,created_at", ...(options.token ? { next_token: options.token } : {}) }));
    },
    async users(ids) {
      if (!ids.length) return [];
      const result = await get<{ data?: { id: string; username: string; name: string; public_metrics?: { followers_count?: number } }[] }>("users", { ids: ids.join(","), "user.fields": "public_metrics" });
      return (result.data || []).map(user => ({ id: user.id, username: user.username, name: user.name, followers: user.public_metrics?.followers_count ?? null }));
    },
  };
}
