---
name: tinyfish
description: Use TinyFish web agent to automate browser tasks, fill forms, navigate multi-step workflows, and extract data from any website including bot-protected sites. Use when you need to interact with websites beyond simple fetching — login flows, form submissions, multi-page navigation, or sites behind Cloudflare/DataDome.
homepage: https://agent.tinyfish.ai
requires:
  env:
    - TINYFISH_API_KEY
---

# TinyFish Web Agent

AI-powered browser automation. Describe what you want in natural language — TinyFish handles the clicking, typing, and navigating.

## Pre-flight Check (REQUIRED)

Before making any API call, **always** run this first:

```bash
[ -n "$TINYFISH_API_KEY" ] && echo "TINYFISH_API_KEY is set" || echo "TINYFISH_API_KEY is NOT set"
command -v jq >/dev/null 2>&1 && echo "jq is available" || echo "jq is NOT installed"
```

If the key is **not set**, you **MUST stop and ask the user** to add their API key. Do **NOT** fall back to other tools — the task requires TinyFish.

Tell the user:

> You need a TinyFish API key. Get one at: <https://agent.tinyfish.ai/api-keys>
>
> Then set it so the agent can use it:
>
> **Option 1 — Environment variable (works everywhere):**
> ```bash
> export TINYFISH_API_KEY="your-key-here"
> ```
>
> **Option 2 — Claude Code settings (Claude Code only):**
> Add to `~/.claude/settings.local.json`:
> ```json
> {
>   "env": {
>     "TINYFISH_API_KEY": "your-key-here"
>   }
> }
> ```

Do NOT proceed until both the key and `jq` are confirmed available.

## Quick Start

### Using the helper script

```bash
# Fill out a contact form
./scripts/run.sh "https://example.com/contact" \
  'Fill the contact form with name "John Doe" and email "john@example.com", then click Submit'

# Same task with stealth mode and geo-proxy
./scripts/run.sh "https://example.com/contact" \
  'Fill the contact form with name "John Doe" and email "john@example.com", then click Submit' \
  --stealth --proxy US
```

### Using curl directly

```bash
curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/contact",
    "goal": "Fill the contact form with name \"John Doe\" and email \"john@example.com\", then click Submit",
    "api_integration": "openclaw"
  }' | jq '.result'
```

## Web Agent Examples

### Form Filling

Describe the form fields and values in natural language. TinyFish finds the inputs, fills them, and submits.

```bash
curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/signup",
    "goal": "Fill the registration form: first name \"Jane\", last name \"Smith\", email \"jane.smith@example.com\", select \"United States\" from the country dropdown, check the terms checkbox, then click the Register button",
    "api_integration": "openclaw"
  }' | jq '.result'
```

### Multi-Step Workflow

Use numbered steps when the task spans multiple pages or actions. TinyFish executes them in order.

```bash
curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/login",
    "goal": "1. Log in with username \"testuser\" and password \"testpass123\"\n2. Navigate to the Account Settings page\n3. Extract the current plan name and renewal date as JSON: {\"plan\": \"string\", \"renewal_date\": \"string\"}",
    "api_integration": "openclaw"
  }' | jq '.result'
```

### Stealth Mode

For sites with bot protection (Cloudflare, DataDome), add `browser_profile: "stealth"`. This uses anti-detection fingerprinting.

```bash
curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://protected-site.com/listings",
    "goal": "Search for \"wireless headphones\" in the search bar, then extract the first 5 results as JSON: [{\"name\": \"string\", \"price\": \"string\", \"rating\": \"string\"}]",
    "browser_profile": "stealth",
    "api_integration": "openclaw"
  }' | jq '.result'
```

### Geo-Proxied Browsing

Access geo-restricted content by routing through a specific country. Combine with stealth mode for protected sites.

```bash
curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.co.uk/products",
    "goal": "Extract the featured product name and price in GBP as JSON: {\"name\": \"string\", \"price\": \"string\", \"currency\": \"GBP\"}",
    "browser_profile": "stealth",
    "proxy_config": {"enabled": true, "country_code": "GB"},
    "api_integration": "openclaw"
  }' | jq '.result'
```

Available country codes: `US`, `GB`, `CA`, `DE`, `FR`, `JP`, `AU`.

## Data Extraction

When you only need to read data from a page, specify the exact JSON schema you want returned — include sample values so TinyFish knows the expected types and format.

### Structured Product Data

```bash
curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/products",
    "goal": "Extract all visible products as a JSON array. Use this exact schema: [{\"name\": \"Example Product\", \"price\": \"$29.99\", \"in_stock\": true, \"url\": \"/product/123\"}]. If a price shows \"Contact Us\", set price to null.",
    "api_integration": "openclaw"
  }' | jq '.result'
```

### Parallel Extraction

When extracting from multiple independent sites, make separate parallel calls — this is faster and more reliable than combining into one goal:

```bash
# Run these simultaneously
curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://store-a.com/product/widget",
    "goal": "Extract the product name and price as JSON: {\"store\": \"Store A\", \"name\": \"string\", \"price\": \"string\"}",
    "api_integration": "openclaw"
  }' | jq '.result' &

curl --max-time 120 -s -X POST "https://agent.tinyfish.ai/v1/automation/run" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://store-b.com/product/widget",
    "goal": "Extract the product name and price as JSON: {\"store\": \"Store B\", \"name\": \"string\", \"price\": \"string\"}",
    "api_integration": "openclaw"
  }' | jq '.result' &

wait
```

## Best Practices

**Be specific (the "intern test").** Think of TinyFish as a capable but literal-minded assistant. If a smart but literal intern would have to guess what you mean, add more detail. Specific goals complete faster and return less noise.

- **Bad:** `"Get product info"`
- **Good:** `"Extract product name, price in USD, and availability as JSON: {\"name\": \"string\", \"price\": \"$0.00\", \"in_stock\": true}"`

**Include sample values in your JSON schema.** This tells TinyFish the expected type and format for each field. Use realistic examples: `"$29.99"` not just `"string"`.

**Use numbered steps for multi-step workflows.** Each step should be one clear action:
```
1. Click the Login button
2. Enter username "testuser" and password "testpass"
3. Navigate to Settings > Billing
4. Extract the current plan name
```

**Add guardrails when needed.** Explicitly say what NOT to do:
- `"Do NOT click any purchase or checkout buttons"`
- `"Do NOT navigate away from this page"`
- `"If a CAPTCHA appears, stop and return {\"error\": \"captcha\"}"`

**Handle edge cases in your goal.** Anticipate what might vary:
- `"If price shows 'Contact Us', set price to null"`
- `"If the page shows 'No results', return an empty array"`
- `"If login fails, return {\"error\": \"login_failed\"}"`

## Error Handling

| HTTP Code | Error | What to Do |
|-----------|-------|------------|
| 401 | `MISSING_API_KEY` / `INVALID_API_KEY` | Check that `$TINYFISH_API_KEY` is set and valid |
| 400 | `INVALID_INPUT` | Verify URL format and that goal is not empty |
| 429 | `RATE_LIMIT_EXCEEDED` | Wait a moment and retry |
| 403 | `FORBIDDEN` | Account has no remaining credits — check your account |
| 500 | `INTERNAL_ERROR` | Transient server error — retry the request |

**Task-level failures** (HTTP 200 but `status: "FAILED"`):

| Symptom | What to Do |
|---------|------------|
| Goal too vague | Make the goal more specific with exact fields and schema |
| Bot detection blocked the task | Add `"browser_profile": "stealth"` |
| Geo-restricted content | Add `"proxy_config"` with the appropriate country code |
| Page requires interaction first | Use numbered steps to navigate to the right state |

### Limitations

- **CAPTCHAs:** Cannot solve reCAPTCHA, hCaptcha, or similar challenges
- **Infinite scroll:** May not automatically scroll to load all dynamic content
- **Session persistence:** Each run starts fresh with no cookies from previous runs
- **Timeout:** Runs have a ~5 minute server-side timeout

## Advanced: SSE Streaming

For long-running tasks where you want real-time progress, use the SSE endpoint or the `--async` flag:

```bash
# Via helper script
./scripts/run.sh "https://example.com" 'Extract all article titles' --async

# Via curl
curl -N -s -X POST "https://agent.tinyfish.ai/v1/automation/run-sse" \
  -H "X-API-Key: $TINYFISH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "goal": "Extract all article titles as a JSON array",
    "api_integration": "openclaw"
  }'
```

SSE event types: `STARTED` (includes `runId`), `STREAMING_URL` (live browser view), `PROGRESS` (browser action updates), `HEARTBEAT`, `COMPLETE` (final result with `status` and `resultJson`).

## Output

The sync endpoint returns a JSON response:

```json
{
  "run_id": "abc-123",
  "status": "COMPLETED",
  "started_at": "2025-01-01T00:00:00Z",
  "finished_at": "2025-01-01T00:01:30Z",
  "num_of_steps": 5,
  "result": { "name": "Widget", "price": "$29.99" },
  "error": null
}
```

- **`COMPLETED`** — Task succeeded. Extracted data is in `result`. Pipe through `jq '.result'` to get just the data.
- **`FAILED`** — Task did not complete. Check `error` for the failure message and refine your goal.
