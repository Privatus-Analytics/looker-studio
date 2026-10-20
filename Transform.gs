/**
 * Pure helpers: field catalogue, query building and API response -> Looker
 * Studio rows. No Apps Script services are used here, so this file is also
 * loaded by the Node test harness (test/transform.test.js) through `vm`.
 *
 * Top-level bindings use `var`/function declarations on purpose so they are
 * visible as globals both in Apps Script and in a vm context.
 */

var DEFAULT_BASE_URL = 'https://privatusanalytics.com';
var MAX_PAGE_LIMIT = 1000; // Stats::Query::MAX_LIMIT on the server
var DEFAULT_MAX_ROWS = 1000;
var HARD_MAX_ROWS = 10000;
var MAX_DAYS_FOR_DAILY_BREAKDOWN = 92;
var DEFAULT_ROWS_PER_DAY = 100;

/** Period presets accepted by the API (Stats::Period::PRESETS). */
var PERIOD_PRESETS = [
  'today', 'yesterday', '24h', '7d', '14d', '28d', '30d', '90d', 'mtd',
  'last_month', 'qtd', 'last_quarter', 'ytd', '12mo', 'last_year', 'all'
];

/**
 * Dimensions. `api` is the dimension key for
 * GET /sites/:id/breakdown/:dimension.json (Stats::Dimensions).
 * `family` decides which metrics the breakdown returns.
 */
var DIMENSIONS = [
  { id: 'date', label: 'Date', semanticType: 'YEAR_MONTH_DAY', api: null, family: 'visit' },
  { id: 'page', label: 'Page', semanticType: 'TEXT', api: 'page', family: 'page' },
  { id: 'source', label: 'Source', semanticType: 'TEXT', api: 'referrer', family: 'visit' },
  { id: 'channel', label: 'Channel', semanticType: 'TEXT', api: 'channel', family: 'visit' },
  { id: 'country', label: 'Country', semanticType: 'COUNTRY_CODE', api: 'country', family: 'visit' },
  { id: 'language', label: 'Language', semanticType: 'TEXT', api: 'language', family: 'visit' },
  { id: 'device', label: 'Device', semanticType: 'TEXT', api: 'device', family: 'visit' },
  { id: 'browser', label: 'Browser', semanticType: 'TEXT', api: 'browser', family: 'visit' },
  { id: 'os', label: 'Operating system', semanticType: 'TEXT', api: 'os', family: 'visit' },
  { id: 'hostname', label: 'Hostname', semanticType: 'TEXT', api: 'hostname', family: 'visit' },
  { id: 'utm_source', label: 'UTM source', semanticType: 'TEXT', api: 'utm_source', family: 'visit' },
  { id: 'utm_medium', label: 'UTM medium', semanticType: 'TEXT', api: 'utm_medium', family: 'visit' },
  { id: 'utm_campaign', label: 'UTM campaign', semanticType: 'TEXT', api: 'utm_campaign', family: 'visit' },
  { id: 'utm_content', label: 'UTM content', semanticType: 'TEXT', api: 'utm_content', family: 'visit' },
  { id: 'utm_term', label: 'UTM term', semanticType: 'TEXT', api: 'utm_term', family: 'visit' },
  { id: 'entry_page', label: 'Entry page', semanticType: 'TEXT', api: 'entry_page', family: 'visit' },
  { id: 'exit_page', label: 'Exit page', semanticType: 'TEXT', api: 'exit_page', family: 'visit' },
  { id: 'event_name', label: 'Event name', semanticType: 'TEXT', api: 'event', family: 'event' },
  { id: 'goal', label: 'Goal', semanticType: 'TEXT', api: 'goal', family: 'goal' }
];

/**
 * Metrics. `from` maps an API family to the response key; a metric missing
 * for a family is returned as null. `scale` converts API units:
 *  - 'pct'      0..100 -> 0..1 (Looker PERCENT)
 *  - 'ms'       milliseconds -> seconds (Looker DURATION)
 *  - 'currency' minor units -> major units (site currency exponent)
 */
var METRICS = [
  { id: 'visitors', label: 'Visitors', semanticType: 'NUMBER', agg: 'SUM',
    from: { visit: 'visitors' } },
  { id: 'visits', label: 'Visits', semanticType: 'NUMBER', agg: 'SUM',
    from: { visit: 'visits', page: 'visits', event: 'visits' } },
  { id: 'pageviews', label: 'Pageviews', semanticType: 'NUMBER', agg: 'SUM',
    from: { visit: 'pageviews', page: 'pageviews' } },
  { id: 'views_per_visit', label: 'Views per visit', semanticType: 'NUMBER', agg: null,
    from: { visit: 'views_per_visit' } },
  { id: 'bounce_rate', label: 'Bounce rate', semanticType: 'PERCENT', agg: null, scale: 'pct',
    from: { visit: 'bounce_rate' } },
  { id: 'visit_duration', label: 'Visit duration (median)', semanticType: 'DURATION', agg: null, scale: 'ms',
    from: { visit: 'visit_duration' } },
  { id: 'time_on_page', label: 'Time on page (median)', semanticType: 'DURATION', agg: null, scale: 'ms',
    from: { page: 'time_on_page' } },
  { id: 'scroll_depth', label: 'Scroll depth (median)', semanticType: 'PERCENT', agg: null, scale: 'pct',
    from: { page: 'scroll_depth' } },
  { id: 'events', label: 'Events (completions)', semanticType: 'NUMBER', agg: 'SUM',
    from: { event: 'completions', goal: 'completions' } },
  { id: 'conversions', label: 'Conversions (unique visits)', semanticType: 'NUMBER', agg: 'SUM',
    from: { event: 'visits', goal: 'conversions' } },
  { id: 'conversion_rate', label: 'Conversion rate', semanticType: 'PERCENT', agg: null, scale: 'pct',
    from: { event: 'conversion_rate', goal: 'conversion_rate' } },
  { id: 'revenue', label: 'Revenue', semanticType: 'CURRENCY', agg: 'SUM', scale: 'currency',
    from: { visit: 'revenue', event: 'revenue', goal: 'revenue' } },
  { id: 'share', label: 'Share of total', semanticType: 'PERCENT', agg: null, scale: 'pct',
    from: { visit: 'share', page: 'share', event: 'share', goal: 'share' } }
];

/** ISO 4217 currencies without minor units (others use 2 decimals). */
var ZERO_DECIMAL_CURRENCIES = [
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
];
var THREE_DECIMAL_CURRENCIES = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

/** Currencies Looker Studio has a CURRENCY_xxx semantic type for (common subset). */
var LOOKER_CURRENCIES = [
  'AED', 'ARS', 'AUD', 'BDT', 'BGN', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP',
  'CZK', 'DKK', 'EGP', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK',
  'JPY', 'KRW', 'LKR', 'MAD', 'MXN', 'MYR', 'NGN', 'NOK', 'NZD', 'PEN', 'PHP',
  'PKR', 'PLN', 'RON', 'RSD', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD',
  'UAH', 'USD', 'VND', 'ZAR'
];

function findDimension(id) {
  for (var i = 0; i < DIMENSIONS.length; i++) if (DIMENSIONS[i].id === id) return DIMENSIONS[i];
  return null;
}

function findMetric(id) {
  for (var i = 0; i < METRICS.length; i++) if (METRICS[i].id === id) return METRICS[i];
  return null;
}

function currencyExponent(currency) {
  var c = String(currency || '').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.indexOf(c) >= 0) return 0;
  if (THREE_DECIMAL_CURRENCIES.indexOf(c) >= 0) return 3;
  return 2;
}

function revenueSemanticType(currency) {
  var c = String(currency || '').toUpperCase();
  return LOOKER_CURRENCIES.indexOf(c) >= 0 ? 'CURRENCY_' + c : 'NUMBER';
}

/**
 * Looker Studio schema (plain JSON form of getSchema().schema).
 * @param {string=} currency site currency, used for the revenue semantic type
 */
function buildSchema(currency) {
  var fields = [];
  DIMENSIONS.forEach(function (d) {
    fields.push({
      name: d.id,
      label: d.label,
      dataType: 'STRING',
      semantics: { conceptType: 'DIMENSION', semanticType: d.semanticType, semanticGroup: d.id === 'date' ? 'DATETIME' : undefined }
    });
  });
  METRICS.forEach(function (m) {
    var semanticType = m.semanticType === 'CURRENCY' ? revenueSemanticType(currency) : m.semanticType;
    var field = {
      name: m.id,
      label: m.label,
      dataType: 'NUMBER',
      semantics: {
        conceptType: 'METRIC',
        semanticType: semanticType,
        isReaggregatable: m.agg !== null
      }
    };
    if (m.agg) field.defaultAggregationType = m.agg;
    fields.push(field);
  });
  fields.forEach(function (f) {
    if (f.semantics.semanticGroup === undefined) delete f.semantics.semanticGroup;
  });
  return fields;
}

/** Schema entries for the requested field names, in request order. */
function schemaForFields(fieldNames, currency) {
  var all = buildSchema(currency);
  return fieldNames.map(function (name) {
    for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
    throw new Error('Unknown field: ' + name);
  });
}

/**
 * Decides which API call(s) answer a getData request.
 * @return {{kind: string, dimension?: object}}
 *   kind: 'aggregate' (no dimension), 'timeseries' (only date),
 *         'breakdown' (one non-date dimension),
 *         'daily_breakdown' (date + one non-date dimension)
 */
function planRequest(fieldNames) {
  var dims = [];
  fieldNames.forEach(function (name) {
    var d = findDimension(name);
    if (d) dims.push(d);
    else if (!findMetric(name)) throw new Error('Unknown field: ' + name);
  });
  var hasDate = dims.some(function (d) { return d.id === 'date'; });
  var others = dims.filter(function (d) { return d.id !== 'date'; });
  if (others.length > 1) {
    throw new Error('Privatus Analytics can break down by one dimension at a time (plus Date). ' +
      'Requested: ' + others.map(function (d) { return d.label; }).join(', ') + '.');
  }
  if (others.length === 0) return { kind: hasDate ? 'timeseries' : 'aggregate' };
  return { kind: hasDate ? 'daily_breakdown' : 'breakdown', dimension: others[0] };
}

/**
 * Period query params. `period` is a preset or 'report' (use the report's
 * date range, the default); dateRange = {startDate, endDate} (YYYY-MM-DD).
 */
function periodParams(period, dateRange) {
  if (period && period !== 'report' && PERIOD_PRESETS.indexOf(period) >= 0) {
    return { period: period };
  }
  if (dateRange && dateRange.startDate && dateRange.endDate) {
    return { period: 'custom', from: dateRange.startDate, to: dateRange.endDate };
  }
  return { period: '30d' };
}

/** Common stats params from the connector config (filters, segment). */
function commonParams(configParams) {
  var cfg = configParams || {};
  var params = {};
  if (cfg.filters && String(cfg.filters).trim()) {
    var raw = String(cfg.filters).trim();
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { throw new Error('Filters must be a JSON array, e.g. [["page","starts_with","/blog"]]'); }
    if (!Array.isArray(parsed)) throw new Error('Filters must be a JSON array.');
    params.filters = JSON.stringify(parsed);
  }
  if (cfg.segment_id && String(cfg.segment_id).trim()) params.segment_id = String(cfg.segment_id).trim();
  return params;
}

function toQueryString(params) {
  return Object.keys(params)
    .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
}

function normalizeBaseUrl(url) {
  var u = String(url || '').trim() || DEFAULT_BASE_URL;
  if (!/^https:\/\//i.test(u)) throw new Error('Base URL must start with https://');
  return u.replace(/\/+$/, '');
}

function buildUrl(baseUrl, path, params) {
  var qs = params ? toQueryString(params) : '';
  return normalizeBaseUrl(baseUrl) + path + (qs ? '?' + qs : '');
}

function clampMaxRows(value) {
  var n = parseInt(value, 10);
  if (!(n > 0)) return DEFAULT_MAX_ROWS;
  return Math.min(n, HARD_MAX_ROWS);
}

/**
 * Pages to request for a breakdown: [{page, limit}] covering maxRows.
 * All pages use the same limit (the API pages by offset = (page-1)*limit).
 */
function breakdownPages(maxRows) {
  var max = clampMaxRows(maxRows);
  var limit = Math.min(max, MAX_PAGE_LIMIT);
  var pages = [];
  for (var p = 1; (p - 1) * limit < max; p++) pages.push({ page: p, limit: limit });
  return pages;
}

/** "2026-09-01T00:00:00Z" or "2026-09-01" -> "20260901". */
function toYmd(value) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? m[1] + m[2] + m[3] : null;
}

/** Inclusive list of YYYY-MM-DD strings. */
function enumerateDays(from, to) {
  var start = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  var end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  var days = [];
  for (var t = start; t <= end; t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function round_(v, digits) {
  var f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** Converts one API metric value to Looker units. */
function metricValue(metric, apiRow, family, ctx) {
  var key = metric.from[family];
  if (!key || apiRow[key] === undefined || apiRow[key] === null) return null;
  var v = Number(apiRow[key]);
  if (isNaN(v)) return null;
  switch (metric.scale) {
    case 'pct': return round_(v / 100, 6);
    case 'ms': return Math.round(v / 1000);
    case 'currency':
      var exp = currencyExponent(ctx && ctx.currency);
      return round_(v / Math.pow(10, exp), exp);
    default: return v;
  }
}

function valuesForRow(fieldNames, apiRow, family, dimValues, ctx) {
  return fieldNames.map(function (name) {
    if (Object.prototype.hasOwnProperty.call(dimValues, name)) return dimValues[name];
    var m = findMetric(name);
    if (m) return metricValue(m, apiRow, family, ctx);
    return null; // a dimension we could not fill
  });
}

/** data of /stats/aggregate.json -> one row. */
function aggregateToRows(data, fieldNames, ctx) {
  var metrics = (data && data.metrics) || {};
  return [{ values: valuesForRow(fieldNames, metrics, 'visit', {}, ctx) }];
}

/** data of /stats/timeseries.json -> rows (one per bucket). */
function timeseriesToRows(data, fieldNames, ctx) {
  var series = (data && data.series) || [];
  return series.map(function (point) {
    return { values: valuesForRow(fieldNames, point, 'visit', { date: toYmd(point.date) }, ctx) };
  });
}

/**
 * data.rows of /breakdown/:dimension.json -> rows.
 * @param {object} dimension entry from DIMENSIONS
 * @param {string=} ymd date value (YYYYMMDD) for daily breakdowns
 */
function breakdownToRows(apiRows, fieldNames, dimension, ctx, ymd) {
  return (apiRows || []).map(function (row) {
    var dims = {};
    dims[dimension.id] = row.value === null || row.value === undefined ? '' : String(row.value);
    if (ymd) dims.date = ymd;
    return { values: valuesForRow(fieldNames, row, dimension.family, dims, ctx) };
  });
}

/** Should we fetch another page after receiving `rows` for `limit`? */
function hasMorePages(dimension, rows, limit) {
  if (dimension.family === 'goal') return false; // goal breakdown ignores paging
  return (rows || []).length >= limit;
}

/** Friendly message from an API error body. */
function apiErrorMessage(status, bodyText) {
  var message = 'HTTP ' + status;
  try {
    var body = JSON.parse(bodyText);
    if (body && body.error) {
      message = (body.error.message || body.error.code || message);
      if (body.error.code) message += ' (' + body.error.code + ')';
    }
  } catch (e) { /* not JSON */ }
  if (status === 401) return 'Privatus Analytics rejected the API token. Re-authorize the connector with a valid pat_… token. ' + message;
  if (status === 403) return 'This API token cannot read analytics for that site. ' + message;
  if (status === 404) return 'Site not found. Check the site id (pa_…). ' + message;
  if (status === 429) return 'Privatus Analytics rate limit reached, try again in a minute. ' + message;
  return 'Privatus Analytics API error: ' + message;
}

/** Select options from workspaces + their sites. */
function siteOptions(workspaces, sitesByWorkspace) {
  var options = [];
  (workspaces || []).forEach(function (ws) {
    (sitesByWorkspace[ws.id] || []).forEach(function (site) {
      var label = (site.name && site.name !== site.domain ? site.name + ' (' + site.domain + ')' : site.domain);
      if ((workspaces || []).length > 1) label = ws.name + ' / ' + label;
      options.push({ label: label, value: site.id });
    });
  });
  return options;
}
