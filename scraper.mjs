#!/usr/bin/env node
// jsonld-lead-kit — extract structured leads from JSON-LD (schema.org) on any web page.
// Free, no API key, no browser. Deterministic → safe to schedule (cron/Actions).
//
//   node scraper.mjs [--targets targets.json] [--out leads]
//
// targets.json = [{
//   "name": "Example Job Board",
//   "url": "https://example.com/jobs",        // listing page OR detail page
//   "types": ["JobPosting", "Organization"],  // schema.org types to look for
//   "linkPattern": "^https://example\\.com/jobs/",  // (optional) detail links on listing pages
//   "follow": 10                              // (optional) max links to follow
// }]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] ?? d : d }
const UA = 'Mozilla/5.0 (compatible; jsonld-lead-kit/1.0)'
const FETCH_TIMEOUT = 9000

/* --- fetch content: try fetch first; if blocked (TLS fingerprint) fall back to curl --- */
const curlText = (url) => new Promise((res, rej) =>
  execFile('curl', ['-sSL', '--max-time', '10', '-A', UA, url], { maxBuffer: 5e6 },
    (e, out) => e ? rej(e) : res(out)))
const grab = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}
const grabAny = async (url) => { try { return await grab(url) } catch { return curlText(url) } }

/* --- JSON-LD: blocks are sometimes technically invalid (control chars in strings) → sanitize --- */
const parseLd = (raw) => { try { return JSON.parse(raw) } catch { return JSON.parse(raw.replace(/[\x00-\x1F]/g, ' ')) } }
const findTypes = (o, wanted, out = []) => {
  if (!o || typeof o !== 'object') return out
  if (Array.isArray(o)) { for (const x of o) findTypes(x, wanted, out); return out }
  if (o['@type'] && wanted.some(t => Array.isArray(o['@type']) ? o['@type'].includes(t) : o['@type'] === t)) out.push(o)
  for (const k of ['@graph', ...Object.keys(o)]) findTypes(o[k], wanted, out)
  return out
}
const extract = (html, types) => {
  const found = []
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = parseLd(m[1]) } catch { continue }
    found.push(...findTypes(j, types))
  }
  return found
}

/* --- normalize: one lead shape across all types --- */
const salaryText = (s) => {
  if (!s) return null
  if (typeof s === 'string') return s || null
  const v = s.value ?? s
  const min = v?.minValue, max = v?.maxValue
  if (min == null && max == null) return null
  const range = min != null && max != null && min !== max ? `${min}–${max}` : (min ?? max)
  if (range === 0) return null // "0" means the source did not publish a salary
  const cur = v.currency ? `${v.currency} ` : ''
  const unit = v.unitText ? `/${String(v.unitText).toLowerCase()}` : ''
  return `${cur}${range}${unit}`
}
const normalize = (o, src) => ({
  type: o['@type'],
  name: o.name ?? o.title ?? o.headline ?? null,
  url: o.url ?? o.mainEntityOfPage?.['@id'] ?? o.mainEntityOfPage ?? o.sameAs?.[0] ?? null,
  description: (o.description ?? '').replace(/\s+/g, ' ').slice(0, 240) || null,
  location: o.jobLocation?.address?.addressLocality ?? o.address?.addressLocality ??
            (Array.isArray(o.address) ? o.address[0]?.addressLocality : null) ??
            o.jobLocationType ?? null,
  salary: salaryText(o.baseSalary),
  posted: o.datePosted ? String(o.datePosted).slice(0, 10) : null,
  validThrough: o.validThrough ? String(o.validThrough).slice(0, 10) : null,
  organization: o.hiringOrganization?.name ?? o.parentOrganization?.name ?? null,
  source: src,
})

/* --- main --- */
const main = async () => {
  const targetsFile = arg('--targets', 'targets.json')
  const outBase = arg('--out', 'leads')
  const targets = JSON.parse(await readFile(targetsFile, 'utf8'))
  const leads = new Map() // dedup by url|name

  for (const t of targets) {
    const types = t.types ?? ['JobPosting']
    let html
    try { html = await grabAny(t.url) } catch (e) { console.error(`x ${t.name}: ${e.message}`); continue }
    let hits = extract(html, types)
    // Listing page → follow detail links. Links may be relative → resolve against base URL.
    // Always follow when requested (listings already ship Organization/WebSite objects,
    // so do not let "hits exist" skip detail pages).
    if (t.linkPattern && (t.follow ?? 0) > 0) {
      const re = new RegExp(t.linkPattern)
      const links = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map(m => {
        try { return new URL(m[1], t.url).href } catch { return null }
      }).filter(Boolean))].filter(u => re.test(u) && !u.startsWith('mailto:')).slice(0, t.follow)
      const pages = await Promise.allSettled(links.map(u => grabAny(u)))
      pages.forEach((p, i) => {
        if (p.status === 'fulfilled') hits.push(...extract(p.value, types))
        else console.error(`  x ${links[i]}: ${p.reason?.message ?? p.reason}`)
      })
    }
    for (const h of hits) {
      const lead = normalize(h, t.name)
      const key = lead.url ?? `${lead.type}|${lead.name}`
      if (!leads.has(key) && lead.name) leads.set(key, lead)
    }
    console.error(`ok ${t.name}: ${hits.length} objects found`)
  }

  const rows = [...leads.values()]
  const now = new Date().toISOString()
  await mkdir('.', { recursive: true })
  await writeFile(`${outBase}.json`, JSON.stringify({ generatedAt: now, count: rows.length, leads: rows }, null, 2))
  const esc = (v) => String(v ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  await writeFile(`${outBase}.md`,
    `# Leads collected — ${now}\n\nTotal: **${rows.length}** leads (from public JSON-LD).\n\n` +
    `| Type | Name | Organization | Salary | Location | Posted | Source |\n|---|---|---|---|---|---|---|\n` +
    rows.map(r => `| ${r.type} | ${esc(r.name)} | ${esc(r.organization)} | ${esc(r.salary)} | ${esc(r.location)} | ${esc(r.posted)} | ${esc(r.source)} |`).join('\n') +
    '\n')
  console.log(`leads: ${rows.length} → ${outBase}.json + ${outBase}.md`)
  if (rows.length === 0) { console.error('warning: 0 leads — check targets/source ToS'); process.exitCode = 1 }
}

main().catch(e => { console.error('failed:', e); process.exitCode = 1 })
