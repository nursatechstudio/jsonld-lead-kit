# JSON-LD Lead Kit

**Collect leads (jobs, companies, products, events) from any web page — via the site's own public JSON-LD.** Free, no API key, no browser, no fingerprint tricks. Set it up once → it runs daily on GitHub Actions.

> Many sites publish structured data (schema.org) in their HTML for search engines — `JobPosting`, `Organization`, `Product`, `Event`. This kit reads that. Legal, light, polite: you read data that is explicitly published for machines to read.

## How it works

```
targets.json  →  fetch page (fetch / curl fallback)  →  extract ld+json blocks
    →  parse (with sanitization)  →  normalize  →  leads.json + leads.md
```

- **`scraper.mjs`** — a single file, zero dependencies (Node ≥ 18).
- **`targets.json`** — your sources plus the schema.org types you want.
- **Daily Actions job** — commits results automatically = a live demo in this repo.

## Run locally

```bash
node scraper.mjs --targets targets.json --out leads
```

Output: `leads.json` (machine-friendly) + `leads.md` (readable table).

## Use in your own repo

1. Fork / `git clone` this repo.
2. Edit `targets.json` — add source URLs and the types you want:
   ```json
   { "name": "My board", "url": "https://example.com/jobs",
     "types": ["JobPosting"], "linkPattern": "/jobs/", "follow": 10 }
   ```
3. Open the **Actions** tab → enable workflows → run `scrape-leads` (or wait for the daily 06:00 UTC schedule).

## Supported schema.org types

| Type | Example lead |
|---|---|
| `JobPosting` | job openings with salary, dates, validity window |
| `Organization` | companies with addresses, contacts |
| `Product` | products with prices |
| `Event` | events with dates and locations |

Extracted fields: `name`, `url`, `description`, `location`, `salary`, `posted`, `validThrough`, `organization` (adapted per type).

## Why not plain scraping

| | Plain scraping | This kit |
|---|---|---|
| Target | DOM you force-fit | JSON-LD built for machines |
| Cost | Dozens of requests, JS rendering | Lightweight, no browser |
| ToS / anti-bot risk | High | Low — public, schema-tagged data |

Two production pitfalls already handled: servers that block Node's TLS fingerprint (403) → automatic `curl` fallback; technically invalid JSON-LD (control characters inside strings) → sanitization before parse.

## Monetization (for developers)

This repo is the free version. A **Pro** tier could add: multi-source parallel fetch, cross-source dedup, CSV/Google Sheets export, CRM integrations — sold via a **Stripe Payment Link** (no extra KYC). FAQ & tutorials go to a separate blog (SEO) linking back here.

---

Built by **nursatechstudio** — automation and scraping anyone can run, anytime, no subscription required.

License: MIT.
