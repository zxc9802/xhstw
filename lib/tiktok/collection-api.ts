import { TikTokServiceError } from "./errors";
import { extractVideoRows, record } from "./videos";

export type CollectionProvider = "scrapecreators" | "tikhub";
export type CollectionApiOptions = { apiKey?: string; scrapeCreatorsApiKey?: string; fetcher?: typeof fetch; signal?: AbortSignal; onFallback?: (message: string) => void };
export const providerLabel = (provider: CollectionProvider) => provider === "scrapecreators" ? "ScrapeCreators" : "TikHub App V3";

export function hasCollectionKey(options: CollectionApiOptions = {}) {
  return Boolean((options.scrapeCreatorsApiKey ?? process.env.SCRAPECREATORS_API_KEY)?.trim() || (options.apiKey ?? process.env.TIKHUB_API_KEY)?.trim());
}

export function createCollectionApi(options: CollectionApiOptions = {}) {
  const keys = { scrapecreators: (options.scrapeCreatorsApiKey ?? process.env.SCRAPECREATORS_API_KEY)?.trim(), tikhub: (options.apiKey ?? process.env.TIKHUB_API_KEY)?.trim() };
  const fetcher = options.fetcher ?? fetch;
  return {
    async request(endpoint: string, params: Record<string, string | number>, preferred?: CollectionProvider): Promise<{ data: Record<string, unknown>; provider: CollectionProvider; offset: number }> {
      const providers: CollectionProvider[] = preferred === "tikhub" || endpoint.startsWith("web/") ? ["tikhub"] : ["scrapecreators", "tikhub"];
      const errors: string[] = [];
      let offset = Number(params.offset ?? 0);
      if (preferred === "scrapecreators" && !keys.scrapecreators && endpoint === "fetch_general_search_result") {
        offset = 0;
        options.onFallback?.("ScrapeCreators 未配置，已切换 TikHub 并从首批重新采集；两者分页游标不通用");
      }
      for (const provider of providers) {
        const key = keys[provider];
        if (!key) continue;
        let url: URL;
        if (provider === "tikhub") {
          url = new URL(endpoint.startsWith("web/") ? endpoint : `app/v3/${endpoint}`, "https://api.tikhub.io/api/v1/tiktok/");
          for (const [name, value] of Object.entries(params)) {
            if (endpoint === "fetch_one_video_v3" && name === "username") continue;
            if (endpoint === "fetch_general_search_result" && name === "region") continue;
            url.searchParams.set(name, String(name === "offset" ? offset : value));
          }
        } else {
          const paths: Record<string, string> = { fetch_general_search_result: "/v1/tiktok/search/keyword", fetch_one_video_v3: "/v2/tiktok/video", handler_user_profile: "/v1/tiktok/profile", fetch_user_country_by_username: "/v1/tiktok/profile/region" };
          url = new URL(paths[endpoint], "https://api.scrapecreators.com");
          const query = endpoint === "fetch_general_search_result" ? { query: params.keyword, date_posted: "this-week", sort_by: "most-liked", region: params.region, cursor: offset }
            : endpoint === "fetch_one_video_v3" ? { url: `https://www.tiktok.com/@${encodeURIComponent(String(params.username))}/video/${params.aweme_id}`, region: params.region, get_transcript: "false" }
            : { handle: params.unique_id ?? params.username };
          for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value));
        }
        try {
          const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
          let response: Response;
          try { response = await fetcher(url.toString(), { headers: provider === "scrapecreators" ? { "x-api-key": key } : { Authorization: `Bearer ${key}` }, signal, cache: "no-store" }); }
          catch { throw new TikTokServiceError(`${providerLabel(provider)} ${endpoint} 连接失败或超时`, 502); }
          if (!response.ok) throw new TikTokServiceError(`${providerLabel(provider)} ${endpoint} HTTP ${response.status}，请检查服务权限与额度`, 502);
          const envelope = record(await response.json().catch(() => null));
          if (provider === "scrapecreators" ? envelope.success !== true : envelope.code !== 200) throw new TikTokServiceError(`${providerLabel(provider)} ${endpoint} 业务状态异常`, 502);
          let data = provider === "scrapecreators" ? envelope : record(envelope.data);
          for (const name of ["status_code", "statusCode"]) if (data[name] !== undefined && data[name] !== 0) throw new TikTokServiceError(`${providerLabel(provider)} ${endpoint} 上游业务状态异常`, 502);
          if (record(data.search_nil_info).search_nil_item === "hit_shark") throw new TikTokServiceError(`${providerLabel(provider)} 上游搜索暂不可用（hit_shark），无法确认候选数量；请稍后重试或联系服务商`, 502);
          if (provider === "scrapecreators") {
            if (endpoint === "fetch_general_search_result") {
              if (!Array.isArray(data.search_item_list)) throw new TikTokServiceError("ScrapeCreators 搜索响应缺少视频列表", 502);
              const rows = data.search_item_list.map(value => record(value).aweme_info ?? value);
              if (rows.length && !rows.some(value => typeof record(value).aweme_id === "string" && typeof record(record(value).author).unique_id === "string")) throw new TikTokServiceError("ScrapeCreators 搜索未提供有效视频身份", 502);
              data = { data: rows, cursor: data.cursor, has_more: data.has_more ?? (rows.length ? 1 : 0) };
            } else if (endpoint === "handler_user_profile") {
              const user = record(data.user), stats = record(data.stats);
              if (typeof user.uniqueId !== "string" || user.uniqueId.toLowerCase() !== String(params.unique_id).toLowerCase()) throw new TikTokServiceError("ScrapeCreators 粉丝接口作者不一致", 502);
              if (!Number.isSafeInteger(stats.followerCount) || Number(stats.followerCount) < 0) throw new TikTokServiceError("ScrapeCreators 未提供有效粉丝数", 502);
              data = { user: { unique_id: user.uniqueId, sec_uid: user.secUid, follower_count: stats.followerCount } };
            } else if (endpoint === "fetch_user_country_by_username") {
              if (typeof data.handle !== "string" || data.handle.toLowerCase() !== String(params.username).toLowerCase()) throw new TikTokServiceError("ScrapeCreators 国家接口作者不一致", 502);
              if (typeof data.region !== "string" || !/^[A-Za-z]{2}$/.test(data.region)) throw new TikTokServiceError("ScrapeCreators 未提供有效账号国家", 502);
              data = { username: data.handle, country: data.region };
            }
          }
          if (endpoint === "fetch_one_video_v3") {
            const row = extractVideoRows(data).find(value => record(value).aweme_id === params.aweme_id), author = record(record(row).author);
            if (!row || typeof author.unique_id !== "string" || author.unique_id.toLowerCase() !== String(params.username).toLowerCase()) throw new TikTokServiceError("原视频详情视频或作者身份不一致", 502);
          }
          return { data, provider, offset };
        } catch (error) {
          const message = error instanceof TikTokServiceError ? error.message : `${providerLabel(provider)} ${endpoint} 响应格式无效`;
          errors.push(message);
          if (provider === "scrapecreators" && keys.tikhub && !options.signal?.aborted) {
            if (endpoint === "fetch_general_search_result") offset = 0;
            options.onFallback?.(`${message}；已切换 TikHub${endpoint === "fetch_general_search_result" && Number(params.offset) > 0 ? " 并从首批重新采集；两者分页游标不通用" : " 备用接口"}`);
          }
        }
        if (options.signal?.aborted) break;
      }
      if (!errors.length && endpoint.startsWith("web/") && keys.scrapecreators) throw new TikTokServiceError("ScrapeCreators 未提供当前内容类目字段，未配置 TikHub 备用，类目待核实", 503);
      if (!errors.length) throw new TikTokServiceError("尚未配置可用采集接口，请设置 SCRAPECREATORS_API_KEY 或 TIKHUB_API_KEY", 503);
      throw new TikTokServiceError(errors.join("；"), 502);
    }
  };
}
