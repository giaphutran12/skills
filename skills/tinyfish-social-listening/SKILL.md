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
4. Run TinyFish Agent only if Search/Fetch produce blocked, failed, or timestamp-incomplete X/LinkedIn evidence.

JSON output:

```bash
npm run listen -- --hours=24 --sentiment --json
```

Disable Agent fallback and force Search/Fetch-only mode:

```bash
npm run listen -- --hours=24 --sentiment --no-agent-fallback
```

Use authenticated Agent fallback with TinyFish Vault credentials:

```bash
npm run listen -- --hours=24 --sentiment --use-vault --linkedin-credential-item-id=cred:...:item-linkedin
```

If one credential should be available to every Agent fallback platform:

```bash
npm run listen -- --hours=24 --sentiment --use-vault --credential-item-id=cred:...:item-shared
```

Save a report:

```bash
mkdir -p reports
npm run listen -- --hours=24 --sentiment > reports/tinyfish-social-listening-$(date -u +%Y%m%dT%H%M%SZ).md
```

## Coverage Rules

- Include every discovered item whose author is not an official TinyFish account.
- Include posts and comments/replies.
- X results must resolve to status URLs; profile/search pages are treated as discovery noise.
- Last 24 hours is strict when source timestamp is available.
- If X/LinkedIn only expose search-snippet results without exact timestamps, keep them under `Needs time verification`; do not pretend they are proven last-24-hour items.
- If Agent fallback runs, include the exact fallback reason in the report.
- Report source failures and blocked pages explicitly.
- Do not summarize away items. Sentiment buckets are optional grouping only.

## Official Account Exclusions

Default exclusions:

- X: `@Tiny_Fish`, `x.com/Tiny_Fish`
- LinkedIn: `linkedin.com/company/tinyfish-ai`
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
- Agent docs say Agent is for natural-language goals where TinyFish decides browser actions, especially multi-step workflows.
- Vault docs say Agent runs can use `use_vault: true` and `credential_item_ids` from `GET /v1/vault/items`; scoped credential IDs prevent the wrong login when multiple accounts exist on one domain.

Operational strategy:

- X and LinkedIn: Search first for discovery, then Fetch every discovered URL for content/timestamps.
- Agent fallback: only for X/LinkedIn when Search/Fetch hits `bot_blocked`, `timeout`, `empty_content`, other fetch failures, search API failures, or timestamp-incomplete results that may hide comments/replies.
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
