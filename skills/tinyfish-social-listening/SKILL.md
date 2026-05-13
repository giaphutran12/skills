---
name: tinyfish-social-listening
description: Track last-24-hour TinyFish mentions across X, LinkedIn, Reddit, and Hacker News. Use when asked to find posts or comments mentioning TinyFish, tinyfish.ai, Search, Fetch, Agent, or related TinyFish product chatter while excluding official TinyFish accounts. Uses TinyFish Search and Fetch first, then Agent only as a documented fallback when Search/Fetch cannot prove completeness because a target site blocks, hides, or requires a multi-step workflow. Returns all discovered posts and comments, with optional sentiment buckets.
requires:
  env:
    - TINYFISH_API_KEY
---

# TinyFish Social Listening

Find TinyFish mentions across X, LinkedIn, Reddit, and Hacker News for the last 24 hours. Default output is all discovered posts/comments, not a summary.

## Preflight

Run:

```bash
[ -n "$TINYFISH_API_KEY" ] && echo "TINYFISH_API_KEY is set" || tinyfish auth status | jq '{authenticated, source}'
node --version
```

The runner uses `TINYFISH_API_KEY` first, then TinyFish CLI auth config execution-only. Do not inspect, print, or summarize real secret files.

## Default Run

Use bundled runner:

```bash
npm run listen -- --hours=24 --sentiment
```

Default behavior:

1. Run TinyFish Search for X/LinkedIn discovery.
2. Run TinyFish Fetch on discovered X/LinkedIn URLs.
3. Run public Reddit/HN APIs for posts and comments.
4. Report coverage gaps when Search/Fetch cannot verify content, comments, or timestamps.

Run the local self-test:

```bash
npm test
```

JSON output:

```bash
npm run listen -- --hours=24 --sentiment --json
```

Enable Agent fallback after credits/auth are available:

```bash
npm run listen -- --hours=24 --sentiment --agent-fallback
```

Use authenticated Agent fallback with TinyFish Vault credentials:

```bash
npm run listen -- --hours=24 --sentiment --agent-fallback --use-vault --linkedin-credential-item-id=cred:...:item-linkedin
```

If one credential should be available to every Agent fallback platform:

```bash
npm run listen -- --hours=24 --sentiment --agent-fallback --use-vault --credential-item-id=cred:...:item-shared
```

For deeper Search pagination, throttle Search to avoid rate limits:

```bash
npm run listen -- --hours=24 --sentiment --max-pages=10 --search-delay-ms=12500
```

Conservative defaults stay within the lower public free-plan limits seen on TinyFish pricing/blog pages: Search `5 req/min` and Fetch `25 url/min`. If your account has higher limits from the API reference or a paid plan, lower `--search-delay-ms` / `--fetch-delay-ms` or increase `--fetch-batch-size`.

Save a report:

```bash
mkdir -p reports
npm run listen -- --hours=24 --sentiment > reports/tinyfish-social-listening-$(date -u +%Y%m%dT%H%M%SZ).md
```

## Coverage Rules

- Include every discovered item whose author is not an official TinyFish account.
- Include posts and comments/replies.
- Treat TinyFish Search as URL discovery only. A Search title/snippet is not proof that the actual post mentions TinyFish.
- For X/LinkedIn, TinyFish Fetch must confirm the fetched page title/body mentions TinyFish before an item can be counted as verified.
- If Fetch returns a readable page but the fetched title/body does not mention TinyFish, treat the Search hit as a false positive.
- If Fetch returns a blocked/login/JavaScript shell, keep Search-matched items under `Needs verification` with `verification_type: content`; do not count them as verified.
- For X status URLs, decode the status ID timestamp when Fetch cannot expose `published_date`; still require Agent/browser verification for blocked content.
- X results must resolve to status URLs; profile/search pages are treated as discovery noise.
- Last 24 hours is strict when source timestamp is available.
- If X/LinkedIn only expose search-snippet results without exact content or timestamps, keep them under `Needs verification`; do not pretend they are proven last-24-hour items.
- Keep `needs_time_verification` only for items whose timestamp cannot be proven. Do not put X snowflake-decoded timestamps there.
- If Agent fallback runs, include the exact fallback reason in the report.
- If Agent fallback is disabled or unavailable, include the exact coverage gap in the report.
- In Search+Fetch-only mode, always report that X/LinkedIn comments and logged-in content are not fully enumerable until Agent/browser verification is available.
- Report source failures and blocked pages explicitly.
- Do not summarize away items. Sentiment buckets are optional grouping only.

## Official Account Exclusions

Default exclusions:

- X: `@Tiny_Fish`, `x.com/Tiny_Fish`
- X operator/insider: `@sudheenair`
- LinkedIn: `linkedin.com/company/tinyfish-ai`
- LinkedIn operator/insider: `Sudheesh Nair`, `linkedin.com/in/sudheenair`, `linkedin.com/posts/sudheenair_`
- Reddit/HN: no known official account by default

Override or add exclusions:

```bash
npm run listen -- --exclude-author=Tiny_Fish --exclude-url=https://www.linkedin.com/company/tinyfish-ai
```

Exclude known irrelevant brand collisions:

```bash
npm run listen -- --exclude-phrase="other product phrase"
```

## Data Strategy

Grounding from TinyFish docs:

- TinyFish docs: <https://docs.tinyfish.ai/>
- Search reference: <https://docs.tinyfish.ai/search-api/reference>
- Fetch reference: <https://docs.tinyfish.ai/fetch-api/reference>
- Agent overview/reference: <https://docs.tinyfish.ai/agent-api> and <https://docs.tinyfish.ai/agent-api/reference>
- Vault setup: <https://docs.tinyfish.ai/vault-setup>
- Anti-bot guide: <https://docs.tinyfish.ai/anti-bot-guide>
- TinyFish docs list four public surfaces: Agent, Search, Fetch, Browser; Search and Fetch are free, Agent and Browser use credits.
- Search docs say Search is for ranked search results, snippets, and URLs.
- Fetch docs say Fetch is for known URLs and clean extracted page content; Fetch renders pages in a real browser and returns extracted text.
- Public TinyFish pricing/blog pages list lower free-plan limits than the current API reference, so the runner defaults to the conservative lower numbers to avoid surprise `429`s.
- Agent docs say Agent is for natural-language goals where TinyFish decides browser actions, especially multi-step workflows.
- Vault docs say Agent runs can use `use_vault: true` and `credential_item_ids` from `GET /v1/vault/items`; scoped credential IDs prevent the wrong login when multiple accounts exist on one domain.

Operational strategy:

- X and LinkedIn: Search first for discovery, then Fetch every discovered URL for content/timestamps.
- Agent fallback: opt-in via `--agent-fallback` for X/LinkedIn when Search/Fetch hits `bot_blocked`, `timeout`, `empty_content`, other fetch failures, search API failures, or timestamp/content-incomplete results that may hide comments/replies.
- Authenticated Agent fallback: use `--use-vault` plus platform-specific `--linkedin-credential-item-id=...` or `--x-credential-item-id=...` when public Search/Fetch cannot see logged-in comments/posts.
- Reddit: public Reddit JSON search for posts/comments, then thread JSON for comments.
- Hacker News: Algolia HN API by date for stories and comments.
- Browser API is not used.

## Cron

Run once or twice daily from this skill directory:

```cron
0 8,20 * * * cd /path/to/tinyfish-social-listening && /usr/bin/env bash -lc 'npm run listen -- --hours=24 --sentiment >> reports/cron-social-listening.md'
```

For production cron, write one timestamped report per run instead of appending if downstream tooling needs immutable artifacts.
