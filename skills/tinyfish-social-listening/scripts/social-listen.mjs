#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_MENTIONS = [
  "TinyFish",
  "tinyfish",
  "tinyfish.ai",
  "TinyFish Search",
  "TinyFish Fetch",
  "TinyFish Agent",
];

const DEFAULT_EXCLUDED_AUTHORS = new Set([
  "tiny_fish",
  "@tiny_fish",
  "sudheenair",
  "@sudheenair",
  "sudheesh nair",
]);

const DEFAULT_EXCLUDED_URL_SUBSTRINGS = [
  "x.com/Tiny_Fish",
  "twitter.com/Tiny_Fish",
  "x.com/sudheenair",
  "twitter.com/sudheenair",
  "linkedin.com/company/tinyfish-ai",
  "linkedin.com/posts/tinyfish-ai_",
  "linkedin.com/in/sudheenair",
  "linkedin.com/posts/sudheenair_",
];

const DEFAULT_EXCLUDED_TEXT_PHRASES = [
  "TINYFISH l Food for Friends",
  "Food for Friends",
  "Tiny Fish Fridges",
  "Bio-Lachs",
  "Thunfisch",
  "Sushi",
  "Gastronomie",
  "FoodConcept",
];

const POSITIVE_WORDS = [
  "love",
  "loved",
  "awesome",
  "great",
  "amazing",
  "fast",
  "free",
  "useful",
  "interesting",
  "excited",
  "impressive",
  "cool",
  "win",
  "better",
  "works",
];

const NEGATIVE_WORDS = [
  "hate",
  "bad",
  "broken",
  "blocked",
  "spam",
  "scam",
  "awful",
  "terrible",
  "gimmick",
  "expensive",
  "slow",
  "worse",
  "fail",
  "failed",
  "useless",
];

const args = parseArgs(process.argv.slice(2));
const now = args.now ? new Date(args.now) : new Date();
assertValidDate(now, "--now");

const hours = Number(args.hours ?? 24);
if (!Number.isFinite(hours) || hours <= 0) {
  fail("--hours must be a positive number");
}

const since = args.since ? new Date(args.since) : new Date(now.getTime() - hours * 60 * 60 * 1000);
assertValidDate(since, "--since");

const mentions = splitCsv(args.mentions).length ? splitCsv(args.mentions) : DEFAULT_MENTIONS;
const excludedAuthors = new Set([
  ...DEFAULT_EXCLUDED_AUTHORS,
  ...splitRepeat(args["exclude-author"]).map(normalizeAuthor),
]);
const excludedUrlSubstrings = [
  ...DEFAULT_EXCLUDED_URL_SUBSTRINGS,
  ...splitRepeat(args["exclude-url"]),
];
const excludedTextPhrases = [
  ...DEFAULT_EXCLUDED_TEXT_PHRASES,
  ...splitRepeat(args["exclude-phrase"]),
];
const credentialIds = {
  x: splitRepeat(args["x-credential-item-id"]),
  linkedin: splitRepeat(args["linkedin-credential-item-id"]),
};
const sharedCredentialIds = splitRepeat(args["credential-item-id"]);

const options = {
  hours,
  since,
  now,
  mentions,
  location: args.location ?? "US",
  language: args.language ?? "en",
  maxSearchPages: Number(args["max-pages"] ?? 2),
  maxFetchUrls: Number(args["max-fetch"] ?? 40),
  includeUnknownTime: Boolean(args["include-unknown-time"]),
  agentFallback: !Boolean(args["no-agent-fallback"]),
  forceAgentFallback: Boolean(args["force-agent-fallback"]),
  useVault: Boolean(args["use-vault"]) || Boolean(credentialIds.x.length || credentialIds.linkedin.length || sharedCredentialIds.length),
  credentialIds: {
    x: credentialIds.x.length ? credentialIds.x : sharedCredentialIds,
    linkedin: credentialIds.linkedin.length ? credentialIds.linkedin : sharedCredentialIds,
  },
  sentiment: Boolean(args.sentiment),
  json: Boolean(args.json),
  debug: Boolean(args.debug),
  excludedAuthors,
  excludedUrlSubstrings,
  excludedTextPhrases,
};

if (!Number.isInteger(options.maxSearchPages) || options.maxSearchPages < 1 || options.maxSearchPages > 10) {
  fail("--max-pages must be an integer from 1 to 10");
}

if (!Number.isInteger(options.maxFetchUrls) || options.maxFetchUrls < 1) {
  fail("--max-fetch must be a positive integer");
}

const apiKey = loadTinyFishApiKey();
if (!apiKey) {
  fail("TinyFish API key not available. Set TINYFISH_API_KEY or run `tinyfish auth login`; do not paste keys into command output.");
}

const state = {
  items: [],
  needsTimeVerification: [],
  falsePositives: [],
  errors: [],
  fallbackRuns: [],
  platformStats: new Map(),
  debug: [],
};

await run();

async function run() {
  await Promise.all([
    collectHackerNews(options),
    collectReddit(options),
    collectTinyFishSearchPlatform("x", buildXQueries(options), options),
    collectTinyFishSearchPlatform("linkedin", buildLinkedInQueries(options), options),
  ]);

  const fallbackPlatforms = ["x", "linkedin"]
    .map((platform) => ({ platform, reasons: agentFallbackReasons(platform, options) }))
    .filter((entry) => entry.reasons.length);

  if (options.agentFallback && fallbackPlatforms.length) {
    await collectAgentFallback(fallbackPlatforms, options);
  }

  const result = buildResult(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderMarkdown(result));
  }
}

async function collectHackerNews(config) {
  const sinceUnix = Math.floor(config.since.getTime() / 1000);
  const tags = ["story", "comment"];

  for (const mention of uniqueSearchMentions(config.mentions)) {
    for (const tag of tags) {
      const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
      url.searchParams.set("query", mention);
      url.searchParams.set("tags", tag);
      url.searchParams.set("numericFilters", `created_at_i>${sinceUnix}`);
      url.searchParams.set("hitsPerPage", "100");

      try {
        const data = await fetchJson(url, { timeoutMs: 20_000 });
        for (const hit of data.hits ?? []) {
          const text = stripHtml(hit.comment_text ?? hit.title ?? hit.story_title ?? "");
          const title = hit.title ?? hit.story_title ?? firstLine(text);
          const author = hit.author ?? "";
          const createdAt = hit.created_at ? new Date(hit.created_at) : null;
          if (!containsMention(`${title}\n${text}`, config.mentions)) continue;
          if (!isWithinWindow(createdAt, config.since, config.now)) continue;
          addItem({
            platform: "hn",
            type: tag === "story" ? "post" : "comment",
            author,
            title,
            text,
            url: hnUrl(hit),
            published_at: createdAt?.toISOString() ?? null,
            source: "hn_algolia",
          }, config);
        }
      } catch (error) {
        recordError("hn", `Algolia ${tag} search failed for ${mention}: ${error.message}`);
      }
    }
  }
}

async function collectReddit(config) {
  for (const mention of uniqueSearchMentions(config.mentions)) {
    await collectRedditListing(mention, "link", config);
    await collectRedditListing(mention, "comment", config);
  }
}

async function collectRedditListing(mention, type, config) {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", mention);
  url.searchParams.set("sort", "new");
  url.searchParams.set("t", config.hours <= 24 ? "day" : "week");
  url.searchParams.set("limit", "100");
  url.searchParams.set("type", type);

  try {
    const data = await fetchJson(url, {
      timeoutMs: 20_000,
      headers: {
        "User-Agent": "tinyfish-social-listening-skill/0.1",
      },
    });

    for (const child of data.data?.children ?? []) {
      const kind = child.kind;
      const item = child.data ?? {};
      const createdAt = item.created_utc ? new Date(item.created_utc * 1000) : null;
      const text = item.selftext || item.body || item.title || "";
      if (!containsMention(`${item.title ?? ""}\n${text}`, config.mentions)) continue;
      if (!isWithinWindow(createdAt, config.since, config.now)) continue;

      const permalink = item.permalink ? `https://www.reddit.com${item.permalink}` : item.url;
      addItem({
        platform: "reddit",
        type: kind === "t1" || type === "comment" ? "comment" : "post",
        author: item.author ?? "",
        title: item.title ?? item.link_title ?? firstLine(text),
        text,
        url: permalink,
        published_at: createdAt?.toISOString() ?? null,
        source: "reddit_search_json",
        score: item.score ?? null,
        community: item.subreddit_name_prefixed ?? item.subreddit ?? null,
      }, config);

      if (kind === "t3" || type === "link") {
        await collectRedditThreadComments(permalink, config);
      }
    }
  } catch (error) {
    recordError("reddit", `Reddit ${type} search failed for ${mention}: ${error.message}`);
  }
}

async function collectRedditThreadComments(permalink, config) {
  if (!permalink || !permalink.includes("reddit.com/")) return;
  const jsonUrl = permalink.replace(/\/?$/, ".json");
  const url = new URL(jsonUrl);
  url.searchParams.set("limit", "500");
  url.searchParams.set("sort", "new");

  try {
    const data = await fetchJson(url, {
      timeoutMs: 20_000,
      headers: {
        "User-Agent": "tinyfish-social-listening-skill/0.1",
      },
    });
    const commentListing = Array.isArray(data) ? data[1] : null;
    walkRedditComments(commentListing?.data?.children ?? [], config);
  } catch (error) {
    recordError("reddit", `Reddit thread comments failed for ${permalink}: ${error.message}`);
  }
}

function walkRedditComments(children, config) {
  for (const child of children) {
    if (child.kind !== "t1") continue;
    const item = child.data ?? {};
    const text = item.body ?? "";
    const createdAt = item.created_utc ? new Date(item.created_utc * 1000) : null;
    if (containsMention(text, config.mentions) && isWithinWindow(createdAt, config.since, config.now)) {
      addItem({
        platform: "reddit",
        type: "comment",
        author: item.author ?? "",
        title: item.link_title ?? firstLine(text),
        text,
        url: item.permalink ? `https://www.reddit.com${item.permalink}` : null,
        published_at: createdAt?.toISOString() ?? null,
        source: "reddit_thread_json",
        score: item.score ?? null,
        community: item.subreddit_name_prefixed ?? item.subreddit ?? null,
      }, config);
    }
    const replies = item.replies?.data?.children;
    if (Array.isArray(replies)) walkRedditComments(replies, config);
  }
}

async function collectTinyFishSearchPlatform(platform, queries, config) {
  const stats = platformStats(platform);
  const discovered = [];
  for (const query of queries) {
    for (let page = 0; page < config.maxSearchPages; page += 1) {
      const url = new URL("https://api.search.tinyfish.ai");
      url.searchParams.set("query", query);
      url.searchParams.set("location", config.location);
      url.searchParams.set("language", config.language);
      url.searchParams.set("page", String(page));

      try {
        const data = await fetchJson(url, {
          timeoutMs: 15_000,
          headers: {
            "X-API-Key": apiKey,
          },
        });
        stats.searchRequests += 1;
        for (const result of data.results ?? []) {
          if (!result.url) continue;
          if (isExcludedUrl(result.url, config.excludedUrlSubstrings)) continue;
          if (!containsMention(`${result.title ?? ""}\n${result.snippet ?? ""}`, config.mentions)) continue;
          stats.discovered += 1;
          discovered.push({
            platform,
            type: "post",
            author: inferAuthor(platform, result.url),
            title: "",
            text: "",
            search_title: result.title ?? "",
            search_snippet: result.snippet ?? "",
            url: result.url,
            published_at: null,
            source: "tinyfish_search",
            search_query: query,
            search_position: result.position ?? null,
            site_name: result.site_name ?? null,
          });
        }
      } catch (error) {
        stats.searchErrors += 1;
        recordError(platform, `TinyFish Search failed for query "${query}": ${error.message}`);
      }
    }
  }

  const deduped = dedupeRaw(discovered);
  const toFetch = deduped.slice(0, config.maxFetchUrls);
  stats.deduped = deduped.length;
  stats.fetchRequested = toFetch.length;
  await enrichWithTinyFishFetch(platform, toFetch, config, stats);

  for (const item of toFetch) {
    const fetchedText = `${item.title ?? ""}\n${item.text ?? ""}`;
    const searchText = `${item.search_title ?? ""}\n${item.search_snippet ?? ""}`;
    const fetchedHasMention = containsMention(fetchedText, config.mentions);
    const searchHasMention = containsMention(searchText, config.mentions);
    if (!fetchedHasMention && !searchHasMention) continue;

    if (!fetchedHasMention && searchHasMention && fetchedContentIsReadable(item)) {
      if (addFalsePositive(item, "Search result mentioned TinyFish, but fetched page body/title did not.", config)) {
        stats.falsePositive += 1;
      }
      continue;
    }

    if (!fetchedHasMention) {
      item.title ||= item.search_title ?? "";
      item.text ||= item.search_snippet ?? "";
      item.verification_note = "Search snippet/title mentioned TinyFish, but Fetch could not read matching page content.";
    }

    const publishedAt = item.published_at ? new Date(item.published_at) : null;
    if (fetchedHasMention && publishedAt && isWithinWindow(publishedAt, config.since, config.now)) {
      if (addItem(item, config)) stats.verified += 1;
    } else if (!publishedAt || !fetchedHasMention) {
      if (addNeedsTimeVerification(item, config)) stats.needsTime += 1;
    } else {
      stats.outsideWindow += 1;
    }
  }
}

async function enrichWithTinyFishFetch(platform, items, config, stats) {
  const batches = chunk(items.map((item) => item.url).filter(Boolean), 10);

  for (const urls of batches) {
    try {
      const data = await fetchJson("https://api.fetch.tinyfish.ai", {
        timeoutMs: 150_000,
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          urls,
          format: "markdown",
          links: false,
          image_links: false,
        }),
      });

      const byUrl = new Map(items.map((item) => [item.url, item]));
      for (const result of data.results ?? []) {
        const item = byUrl.get(result.url) ?? byUrl.get(result.final_url);
        if (!item) continue;
        stats.fetchSuccess += 1;
        item.fetch_status = "success";
        item.final_url = result.final_url ?? result.url;
        item.title = result.title || item.title;
        item.text = trimText(result.text || item.text, 2000);
        item.author = result.author || item.author;
        item.published_at = normalizeDateString(result.published_date);
        if (!item.published_at && platform === "x") {
          item.published_at = publishedAtFromXStatusId(item.url);
          if (item.published_at) item.timestamp_source = "x_status_id";
        }
        item.source = `${item.source}+tinyfish_fetch`;
      }

      for (const error of data.errors ?? []) {
        stats.fetchErrors += 1;
        stats.fetchErrorCodes[error.error ?? "unknown"] = (stats.fetchErrorCodes[error.error ?? "unknown"] ?? 0) + 1;
        recordError(platform, `TinyFish Fetch failed for ${error.url}: ${error.error}${error.status ? ` ${error.status}` : ""}`);
      }
    } catch (error) {
      stats.fetchErrors += urls.length;
      stats.fetchErrorCodes.batch_error = (stats.fetchErrorCodes.batch_error ?? 0) + 1;
      recordError(platform, `TinyFish Fetch batch failed: ${error.message}`);
    }
  }
}

function fetchedContentIsReadable(item) {
  if (item.fetch_status !== "success") return false;
  return !isBlockedOrShellPage(item.text);
}

function isBlockedOrShellPage(text) {
  const lower = String(text ?? "").toLowerCase();
  return [
    "javascript is disabled",
    "please enable javascript",
    "login to continue",
    "sign in to continue",
    "captcha",
    "access denied",
    "unsupported browser",
  ].some((phrase) => lower.includes(phrase));
}

function agentFallbackReasons(platform, config) {
  if (config.forceAgentFallback) return ["forced by --force-agent-fallback"];
  const stats = platformStats(platform);
  const reasons = [];
  if (stats.searchErrors > 0) reasons.push("TinyFish Search failed for one or more queries");
  if (stats.fetchErrors > 0) {
    const codes = Object.keys(stats.fetchErrorCodes).sort().join(", ") || "unknown";
    reasons.push(`TinyFish Fetch returned failed URL(s): ${codes}`);
  }
  if (stats.deduped > 0 && stats.fetchSuccess === 0) {
    reasons.push("TinyFish Search found URLs but TinyFish Fetch extracted no successful pages");
  }
  if (stats.needsTime > 0) {
    reasons.push("TinyFish Search/Fetch found result(s) needing content or timestamp verification");
  }
  return reasons;
}

async function collectAgentFallback(fallbackPlatforms, config) {
  const requested = new Map(fallbackPlatforms.map((entry) => [entry.platform, entry.reasons]));
  const agentJobs = [
    {
      platform: "x",
      url: xSearchUrl(config),
      goal: [
        "Search X for TinyFish mentions from the last 24 hours.",
        "Exclude posts from @Tiny_Fish and @sudheenair.",
        "Extract every visible post and reply/comment mentioning TinyFish, tinyfish.ai, TinyFish Search, TinyFish Fetch, or TinyFish Agent.",
        "Return only JSON array items with: platform, type, author, title, text, url, published_at.",
        "If login, CAPTCHA, or access wall blocks results, return {\"error\":\"blocked\",\"reason\":\"...\"}.",
      ].join(" "),
    },
    {
      platform: "linkedin",
      url: linkedInSearchUrl(config),
      goal: [
        "Search LinkedIn content for TinyFish mentions from the last 24 hours.",
        "Exclude posts from the official TinyFish company page and Sudheesh Nair/sudheenair.",
        "Extract every visible post and comment mentioning TinyFish, tinyfish.ai, TinyFish Search, TinyFish Fetch, or TinyFish Agent.",
        "Return only JSON array items with: platform, type, author, title, text, url, published_at.",
        "If login, CAPTCHA, or access wall blocks results, return {\"error\":\"blocked\",\"reason\":\"...\"}.",
      ].join(" "),
    },
  ].filter((job) => requested.has(job.platform));

  for (const job of agentJobs) {
    state.fallbackRuns.push({
      platform: job.platform,
      endpoint: "https://agent.tinyfish.ai/v1/automation/run",
      reasons: requested.get(job.platform),
      use_vault: config.useVault,
      credential_item_ids: config.credentialIds[job.platform]?.length ?? 0,
    });

    try {
      const body = {
        url: job.url,
        goal: job.goal,
        browser_profile: "stealth",
        api_integration: "openclaw",
      };
      const selectedCredentialIds = config.credentialIds[job.platform] ?? [];
      if (config.useVault) {
        body.use_vault = true;
        if (selectedCredentialIds.length) body.credential_item_ids = selectedCredentialIds;
      }

      const data = await fetchJson("https://agent.tinyfish.ai/v1/automation/run", {
        timeoutMs: 150_000,
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const parsed = parseAgentItems(data);
      if (parsed.error) {
        recordError(job.platform, `TinyFish Agent fallback blocked/failed: ${parsed.reason ?? parsed.error}`);
        continue;
      }

      for (const item of parsed) {
        const publishedAt = item.published_at ? new Date(item.published_at) : null;
        const normalized = {
          platform: job.platform,
          type: item.type || "post",
          author: item.author || "",
          title: item.title || firstLine(item.text || ""),
          text: item.text || "",
          url: item.url || job.url,
          published_at: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : null,
          source: "tinyfish_agent",
        };
        if (!containsMention(`${normalized.title}\n${normalized.text}`, config.mentions)) continue;
        if (normalized.published_at && isWithinWindow(new Date(normalized.published_at), config.since, config.now)) {
          addItem(normalized, config);
        } else if (!normalized.published_at) {
          addNeedsTimeVerification(normalized, config);
        }
      }
    } catch (error) {
      recordError(job.platform, `TinyFish Agent fallback failed: ${error.message}`);
    }
  }
}

function parseAgentItems(data) {
  const candidates = [
    data?.result_json,
    data?.result,
    data?.output,
    data?.data,
    data,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) return candidate;
    if (typeof candidate === "object" && candidate.error) return candidate;
    if (typeof candidate === "object" && Array.isArray(candidate.items)) return candidate.items;
    if (typeof candidate !== "string") continue;

    const parsed = parseJsonFromText(candidate);
    if (Array.isArray(parsed) || parsed?.error || Array.isArray(parsed?.items)) {
      return Array.isArray(parsed) ? parsed : parsed.items ?? parsed;
    }
  }

  recordDebug(`Could not parse agent result: ${JSON.stringify(data).slice(0, 500)}`);
  return [];
}

function parseJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    const start = Math.min(...["[", "{"].map((char) => {
      const index = text.indexOf(char);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }));
    if (!Number.isFinite(start)) return null;
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function buildXQueries(config) {
  const date = ymd(config.since);
  const exclusions = "-site:x.com/Tiny_Fish -site:x.com/sudheenair";
  return [
    `"TinyFish" site:x.com ${exclusions} after:${date}`,
    `"tinyfish.ai" site:x.com ${exclusions} after:${date}`,
    `"TinyFish Search" OR "TinyFish Fetch" site:x.com ${exclusions} after:${date}`,
  ];
}

function buildLinkedInQueries(config) {
  const date = ymd(config.since);
  const exclusions = "-site:linkedin.com/company/tinyfish-ai -site:linkedin.com/posts/sudheenair_ -site:linkedin.com/in/sudheenair";
  return [
    `"TinyFish" site:linkedin.com/posts ${exclusions} after:${date}`,
    `"tinyfish.ai" site:linkedin.com/posts ${exclusions} after:${date}`,
    `"TinyFish Search" OR "TinyFish Fetch" site:linkedin.com/posts ${exclusions} after:${date}`,
  ];
}

function xSearchUrl(config) {
  const query = encodeURIComponent(`("TinyFish" OR "tinyfish.ai" OR "TinyFish Search" OR "TinyFish Fetch") since:${ymd(config.since)} -from:Tiny_Fish -from:sudheenair`);
  return `https://x.com/search?q=${query}&src=typed_query&f=live`;
}

function linkedInSearchUrl(config) {
  const query = encodeURIComponent("TinyFish OR tinyfish.ai OR TinyFish Search OR TinyFish Fetch");
  return `https://www.linkedin.com/search/results/content/?keywords=${query}&sortBy=%22date_posted%22`;
}

function addItem(item, config) {
  if (isExcluded(item, config)) return false;
  const normalized = normalizeItem(item, config.sentiment);
  if (state.items.some((existing) => itemKey(existing) === itemKey(normalized))) return false;
  state.items.push(normalized);
  return true;
}

function addNeedsTimeVerification(item, config) {
  if (isExcluded(item, config)) return false;
  const normalized = normalizeItem(item, config.sentiment);
  if (state.items.some((existing) => itemKey(existing) === itemKey(normalized))) return false;
  if (state.needsTimeVerification.some((existing) => itemKey(existing) === itemKey(normalized))) return false;
  state.needsTimeVerification.push(normalized);
  return true;
}

function addFalsePositive(item, reason, config) {
  if (isExcluded(item, config)) return false;
  const normalized = normalizeItem(item, config.sentiment);
  normalized.reason = reason;
  if (state.falsePositives.some((existing) => itemKey(existing) === itemKey(normalized))) return false;
  state.falsePositives.push(normalized);
  return true;
}

function normalizeItem(item, includeSentiment) {
  const normalized = {
    platform: item.platform,
    type: item.type ?? "post",
    author: item.author ?? "",
    title: item.title ?? "",
    text: trimText(stripHtml(String(item.text ?? "")), 2000),
    url: item.url ?? item.final_url ?? "",
    published_at: item.published_at ?? null,
    source: item.source ?? "unknown",
  };
  if (item.score != null) normalized.score = item.score;
  if (item.community) normalized.community = item.community;
  if (item.search_query) normalized.search_query = item.search_query;
  if (item.search_title) normalized.search_title = item.search_title;
  if (item.search_snippet) normalized.search_snippet = item.search_snippet;
  if (item.search_position) normalized.search_position = item.search_position;
  if (item.site_name) normalized.site_name = item.site_name;
  if (item.timestamp_source) normalized.timestamp_source = item.timestamp_source;
  if (item.verification_note) normalized.verification_note = item.verification_note;
  if (includeSentiment) normalized.sentiment = classifySentiment(`${normalized.title}\n${normalized.text}`);
  return normalized;
}

function buildResult(config) {
  const byPublishedAt = (a, b) => {
    const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
    const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
    return bTime - aTime;
  };

  state.items.sort(byPublishedAt);
  state.needsTimeVerification.sort((a, b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title));
  state.falsePositives.sort((a, b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title));

  return {
    generated_at: config.now.toISOString(),
    window: {
      since: config.since.toISOString(),
      until: config.now.toISOString(),
      hours: config.hours,
    },
    counts: {
      verified_items: state.items.length,
      needs_verification: state.needsTimeVerification.length,
      needs_time_verification: state.needsTimeVerification.length,
      false_positives: state.falsePositives.length,
      agent_fallback_runs: state.fallbackRuns.length,
      errors: state.errors.length,
    },
    docs_grounding: [
      "https://docs.tinyfish.ai/",
      "https://docs.tinyfish.ai/search-api/reference",
      "https://docs.tinyfish.ai/fetch-api/reference",
      "https://docs.tinyfish.ai/agent-api",
      "https://docs.tinyfish.ai/agent-api/reference",
      "https://docs.tinyfish.ai/vault-setup",
      "https://docs.tinyfish.ai/anti-bot-guide",
    ],
    items: state.items,
    needs_time_verification: state.needsTimeVerification,
    false_positives: state.falsePositives,
    agent_fallback_runs: state.fallbackRuns,
    platform_stats: Object.fromEntries(state.platformStats),
    sentiment: config.sentiment ? groupBySentiment(state.items) : undefined,
    errors: state.errors,
    debug: config.debug ? state.debug : undefined,
  };
}

function renderMarkdown(result) {
  const lines = [];
  lines.push("# TinyFish Social Listening");
  lines.push("");
  lines.push(`Generated: ${result.generated_at}`);
  lines.push(`Window: ${result.window.since} to ${result.window.until}`);
  lines.push(`Verified items: ${result.counts.verified_items}`);
  lines.push(`Needs verification: ${result.counts.needs_verification}`);
  lines.push(`False positives: ${result.counts.false_positives}`);
  lines.push(`Agent fallback runs: ${result.counts.agent_fallback_runs}`);
  lines.push(`Errors: ${result.counts.errors}`);
  lines.push("");
  lines.push("Docs grounding:");
  for (const url of result.docs_grounding) lines.push(`- ${url}`);
  lines.push("");

  if (result.agent_fallback_runs.length) {
    lines.push("## Agent Fallback");
    for (const run of result.agent_fallback_runs) {
      lines.push(`- ${run.platform}: ${run.reasons.join("; ")}`);
    }
    lines.push("");
  }

  if (result.sentiment) {
    lines.push("## Sentiment");
    for (const sentiment of ["excited", "neutral", "hate"]) {
      lines.push(`- ${sentiment}: ${result.sentiment[sentiment]?.length ?? 0}`);
    }
    lines.push("");
  }

  lines.push("## Verified Last-24h Items");
  if (!result.items.length) {
    lines.push("");
    lines.push("No verified last-24h mentions found.");
  } else {
    renderItems(lines, result.items);
  }

  lines.push("");
  lines.push("## Needs Verification");
  if (!result.needs_time_verification.length) {
    lines.push("");
    lines.push("None.");
  } else {
    lines.push("");
    lines.push("These matched the mention query, but Search/Fetch could not fully verify content or timestamp.");
    renderItems(lines, result.needs_time_verification);
  }

  if (result.errors.length) {
    lines.push("");
    lines.push("## Source Failures");
    for (const error of result.errors) {
      lines.push(`- ${error.platform}: ${error.message}`);
    }
  }

  if (result.false_positives.length) {
    lines.push("");
    lines.push("## False Positives");
    lines.push("");
    lines.push("Search found these URLs, but Fetch showed the actual page did not mention TinyFish.");
    renderItems(lines, result.false_positives);
  }

  if (result.debug?.length) {
    lines.push("");
    lines.push("## Debug");
    for (const item of result.debug) lines.push(`- ${item}`);
  }

  return lines.join("\n");
}

function renderItems(lines, items) {
  const grouped = groupBy(items, (item) => item.platform);
  for (const platform of Object.keys(grouped).sort()) {
    lines.push("");
    lines.push(`### ${platform}`);
    for (const item of grouped[platform]) {
      const title = item.title || firstLine(item.text) || "(untitled)";
      const meta = [
        item.type,
        item.author ? `by ${item.author}` : null,
        item.published_at ?? "time unknown",
        item.sentiment ? `sentiment: ${item.sentiment}` : null,
        item.community,
      ].filter(Boolean).join(" | ");
      lines.push("");
      lines.push(`- ${title}`);
      lines.push(`  - ${meta}`);
      if (item.url) lines.push(`  - ${item.url}`);
      if (item.text) lines.push(`  - ${singleLine(item.text)}`);
    }
  }
}

function groupBySentiment(items) {
  return {
    excited: items.filter((item) => item.sentiment === "excited"),
    neutral: items.filter((item) => item.sentiment === "neutral"),
    hate: items.filter((item) => item.sentiment === "hate"),
  };
}

function classifySentiment(text) {
  const lower = text.toLowerCase();
  let positive = 0;
  let negative = 0;
  for (const word of POSITIVE_WORDS) {
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(lower)) positive += 1;
  }
  for (const word of NEGATIVE_WORDS) {
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(lower)) negative += 1;
  }
  if (negative > positive) return "hate";
  if (positive > negative || /!{2,}/.test(text)) return "excited";
  return "neutral";
}

async function fetchJson(input, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(input, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    if (!text.trim()) return {};
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals === -1) {
      parsed[raw] = true;
      continue;
    }
    const key = raw.slice(0, equals);
    const value = raw.slice(equals + 1);
    if (parsed[key] === undefined) {
      parsed[key] = value;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(value);
    } else {
      parsed[key] = [parsed[key], value];
    }
  }
  return parsed;
}

function splitCsv(value) {
  if (!value || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function splitRepeat(value) {
  if (!value || value === true) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((item) => splitCsv(item));
}

function uniqueSearchMentions(mentions) {
  return [...new Set(mentions.filter((mention) => !mention.includes(" ") || mention.includes(".")))].slice(0, 6);
}

function containsMention(text, mentions) {
  const lower = String(text).toLowerCase();
  return mentions.some((mention) => lower.includes(mention.toLowerCase()));
}

function normalizeAuthor(author) {
  return String(author ?? "").trim().toLowerCase().replace(/^@/, "");
}

function isExcluded(item, config) {
  const author = normalizeAuthor(item.author);
  if (author && config.excludedAuthors.has(author)) return true;
  if (item.platform === "linkedin" && author === "tinyfish") return true;
  if (item.platform === "x" && item.url && !isXStatusUrl(item.url)) return true;
  if (containsExcludedText(item, config.excludedTextPhrases)) return true;
  return isExcludedUrl(item.url, config.excludedUrlSubstrings);
}

function containsExcludedText(item, excludedPhrases) {
  const text = `${item.title ?? ""}\n${item.text ?? ""}\n${item.search_snippet ?? ""}`.toLowerCase();
  return excludedPhrases.some((phrase) => text.includes(String(phrase).toLowerCase()));
}

function isExcludedUrl(url, excluded) {
  if (!url) return false;
  const normalized = String(url).toLowerCase();
  return excluded.some((part) => normalized.includes(String(part).toLowerCase()));
}

function isXStatusUrl(url) {
  try {
    const parsed = new URL(url);
    return /(?:^|\.)x\.com$/i.test(parsed.hostname) && /^\/[^/]+\/status\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isWithinWindow(date, since, until) {
  return date instanceof Date
    && !Number.isNaN(date.getTime())
    && date.getTime() >= since.getTime()
    && date.getTime() <= until.getTime();
}

function inferAuthor(platform, url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (platform === "x" && parts[0]) return parts[0];
    if (platform === "linkedin" && parts[0] === "posts" && parts[1]) return parts[1].split("_")[0];
    if (platform === "linkedin" && parts[0] === "in" && parts[1]) return parts[1];
    if (platform === "linkedin" && parts[0] === "company" && parts[1]) return parts[1];
  } catch {
    return "";
  }
  return "";
}

function hnUrl(hit) {
  if (hit.url) return hit.url;
  if (hit.story_url && hit.objectID === String(hit.story_id)) return hit.story_url;
  return `https://news.ycombinator.com/item?id=${hit.objectID}`;
}

function normalizeDateString(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function publishedAtFromXStatusId(url) {
  const match = String(url ?? "").match(/\/status\/(\d+)/);
  if (!match) return null;

  try {
    const twitterEpochMs = 1288834974657n;
    const timestampMs = Number((BigInt(match[1]) >> 22n) + twitterEpochMs);
    const date = new Date(timestampMs);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function firstLine(value) {
  return singleLine(value).slice(0, 120);
}

function singleLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function trimText(value, maxLength) {
  const text = singleLine(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function itemKey(item) {
  const base = item.url || `${item.platform}:${item.author}:${item.title}:${item.text}`;
  return String(base).toLowerCase().replace(/[?#].*$/, "");
}

function dedupeRaw(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function groupBy(items, keyFn) {
  const grouped = {};
  for (const item of items) {
    const key = keyFn(item);
    grouped[key] ??= [];
    grouped[key].push(item);
  }
  return grouped;
}

function platformStats(platform) {
  if (!state.platformStats.has(platform)) {
    state.platformStats.set(platform, {
      searchRequests: 0,
      searchErrors: 0,
      discovered: 0,
      deduped: 0,
      fetchRequested: 0,
      fetchSuccess: 0,
      fetchErrors: 0,
      fetchErrorCodes: {},
      verified: 0,
      needsTime: 0,
      falsePositive: 0,
      outsideWindow: 0,
    });
  }
  return state.platformStats.get(platform);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function assertValidDate(date, label) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    fail(`${label} must be a valid date`);
  }
}

function loadTinyFishApiKey() {
  if (process.env.TINYFISH_API_KEY) return process.env.TINYFISH_API_KEY;

  const configPath = path.join(os.homedir(), ".tinyfish", "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    for (const key of ["apiKey", "api_key", "key", "TINYFISH_API_KEY"]) {
      if (typeof config[key] === "string" && config[key].trim()) {
        return config[key].trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recordError(platform, message) {
  state.errors.push({ platform, message });
}

function recordDebug(message) {
  state.debug.push(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
