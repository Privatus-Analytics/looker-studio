# Privatus Analytics — Looker Studio connector

**Your Privatus Analytics numbers in Looker Studio reports.**

Your team builds reports in Looker Studio. But your website numbers live in
another dashboard, so someone copies them over by hand.

This connector reads your stats through the Privatus Analytics API and brings
them into Looker Studio: visitors, pageviews, sources, countries, pages, goals,
revenue and more.

So your website numbers sit next to the rest of your data in one report, and
they stay up to date. The numbers are honest too. Privatus Analytics counts
visits without cookies, so there is no cookie pop-up for your analytics, and it
leaves bots out.

**Free plan, no card:** 10,000 events a month (an event is a page view or an action you track) on up to 3 sites. [Start free at privatusanalytics.com](https://privatusanalytics.com).

## What you get

**Dimensions**: Date, Page, Source (referrer), Channel, Country (ISO code), Language,
Device, Browser, Operating system, Hostname, UTM source / medium / campaign /
content / term, Entry page, Exit page, Event name, Goal.

**Metrics**: Visitors, Visits, Pageviews, Views per visit, Bounce rate, Visit
duration (median), Time on page (median), Scroll depth (median), Events
(completions), Conversions (unique visits), Conversion rate, Revenue, Share of total.

Units are converted to what Looker Studio expects: rates are ratios (`PERCENT`),
durations are seconds (`DURATION`), revenue is in major units of the site
currency (`CURRENCY_xxx`).

| Fields in the chart         | API call                                             |
|-----------------------------|------------------------------------------------------|
| metrics only (scorecards)   | `GET /sites/{id}/stats/aggregate.json`               |
| Date + metrics              | `GET /sites/{id}/stats/timeseries.json?interval=day` |
| one dimension + metrics     | `GET /sites/{id}/breakdown/{dimension}.json` (paged with `page` + `limit` ≤ 1000, up to "Max rows") |
| Date + one dimension        | one breakdown per day (`period=custom&from=D&to=D`), ≤ 92 days |

The report date range is sent as `period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
unless you pick a fixed period preset in the data source config.

Not every metric exists for every dimension (the API returns different shapes):

- Visit dimensions (source, channel, country, device, UTM, entry/exit page, …) and
  Date: visitors, visits, pageviews, views per visit, bounce rate, visit duration, revenue.
- Page: pageviews, visits, time on page, scroll depth.
- Event name: events, conversions, conversion rate, revenue.
- Goal: events, conversions, conversion rate, revenue.

Unavailable combinations return empty (null) values. Only one non-date dimension
per chart is supported (the API has no cross-tabulation); use the *Filters*
config option instead (e.g. `[["country","is","DE"]]`).

## Install (deploy your own copy)

1. Create an API token in Privatus Analytics (*Account → API tokens*, `pat_…`) with
   `analytics.read` on the sites you want.
2. Push the code to a new Apps Script project with [clasp](https://github.com/google/clasp):

   ```sh
   npm i -g @google/clasp@3.4.1   # an exact release: clasp gets your Google login
   clasp login
   clasp create --type standalone --title "Privatus Analytics connector"
   clasp push          # uploads appsscript.json + *.gs (see .claspignore)
   ```

   Or copy `appsscript.json` (enable *Show "appsscript.json"* in Project settings)
   and every `.gs` file into a new project at <https://script.google.com>.
3. *Deploy → New deployment → Add-on / Looker Studio connector* (or
   *Deploy → Test deployments → Install*), then open the deployment link
   `https://lookerstudio.google.com/datasources/create?connectorId=<DEPLOYMENT_ID>`.
4. Paste your `pat_…` token when asked, pick the site, keep *Period = Report date
   range*, and connect.

### Self-hosted

The manifest restricts outgoing requests to `https://privatusanalytics.com/`
(`urlFetchWhitelist`). For another host:

- add its prefix to `urlFetchWhitelist` in `appsscript.json` (e.g. `"https://stats.example.com/"`),
- set the script property `PRIVATUS_BASE_URL` (Project settings → Script properties)
  so the token check and the site picker use it, and/or set *API base URL* in the
  data source config.

## Configuration options

| Option | Notes |
|---|---|
| Site / Site id | Picker built from `GET /workspaces.json` → `GET /workspaces/{id}/sites.json`; the text field overrides it. |
| Period | *Report date range* (default) or a preset (`7d`, `30d`, `mtd`, `12mo`, …). |
| Max rows per breakdown | Default 1000, max 10000 (100 per day for Date + dimension). |
| Filters | Privatus Analytics JSON filter array, passed as `filters=`. |
| Segment id | `seg_…`, passed as `segment_id=`. |
| API base URL | See above. |

## Privacy & security

- The API token is stored with `PropertiesService.getUserProperties()` — only for the
  Google user who entered it, never logged. `resetAuth` removes it.
- The connector only reads aggregated statistics; Privatus Analytics stores no cookies or
  personal identifiers, so nothing personal can flow into your reports.
- `isAdminUser()` returns `false` (no debug data exposed).

## Development

`Transform.gs` holds all pure logic (field catalogue, query building,
response → row mapping). It is loaded into a Node `vm` context by the tests:

```sh
docker run --rm -v "$PWD":/w -w /w node:22 sh -c 'node --test'
```

Files: `appsscript.json` (manifest), `Auth.gs` (KEY auth), `Code.gs` (getConfig,
getData), `Schema.gs` (getSchema), `Api.gs` (UrlFetchApp), `Transform.gs` (pure).

## License

MIT — see [LICENSE](LICENSE).
