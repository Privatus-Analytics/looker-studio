/**
 * Privatus Analytics — Looker Studio community connector entry points:
 * getConfig, getSchema, getData (auth lives in Auth.gs, HTTP in Api.gs,
 * pure mapping in Transform.gs).
 */

function getConfig(request) {
  var cc = DataStudioApp.createCommunityConnector();
  var config = cc.getConfig();
  var token = getToken_();

  config.newInfo()
    .setId('intro')
    .setText('Pick a Privatus Analytics site. Reports use the report date range unless you choose a fixed period.');

  var options = token ? listSiteOptions_(token, defaultBaseUrl_()) : [];
  if (options.length) {
    var select = config.newSelectSingle()
      .setId('site_select')
      .setName('Site')
      .setHelpText('Sites from every workspace this API token can read.')
      .setAllowOverride(true);
    options.forEach(function (o) {
      select.addOption(config.newOptionBuilder().setLabel(o.label).setValue(o.value));
    });
  }

  config.newTextInput()
    .setId('site_id')
    .setName(options.length ? 'Site id (overrides the selection)' : 'Site id')
    .setHelpText('The site id from Site settings, e.g. pa_7Q2K9XH3AB.')
    .setPlaceholder('pa_…')
    .setAllowOverride(true);

  var period = config.newSelectSingle()
    .setId('period')
    .setName('Period')
    .setHelpText('"Report date range" follows the date range control; a preset ignores it.')
    .setAllowOverride(true);
  period.addOption(config.newOptionBuilder().setLabel('Report date range').setValue('report'));
  [
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['24h', 'Last 24 hours'],
    ['7d', 'Last 7 days'], ['14d', 'Last 14 days'], ['28d', 'Last 28 days'],
    ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['mtd', 'Month to date'],
    ['last_month', 'Last month'], ['qtd', 'Quarter to date'], ['last_quarter', 'Last quarter'],
    ['ytd', 'Year to date'], ['12mo', 'Last 12 months'], ['last_year', 'Last year'], ['all', 'All time']
  ].forEach(function (p) {
    period.addOption(config.newOptionBuilder().setLabel(p[1]).setValue(p[0]));
  });

  config.newTextInput()
    .setId('max_rows')
    .setName('Max rows per breakdown')
    .setHelpText('Rows fetched for a dimension (pages of up to 1000). Default 1000, max 10000. With Date + a dimension this is rows per day (default 100).')
    .setPlaceholder('1000')
    .setAllowOverride(true);

  config.newTextInput()
    .setId('filters')
    .setName('Filters (advanced, JSON)')
    .setHelpText('Privatus Analytics filters, e.g. [["page","starts_with","/blog"],["country","any_of",["DE","FR"]]]')
    .setAllowOverride(true);

  config.newTextInput()
    .setId('segment_id')
    .setName('Segment id (advanced)')
    .setPlaceholder('seg_…')
    .setAllowOverride(true);

  config.newTextInput()
    .setId('base_url')
    .setName('API base URL (advanced)')
    .setHelpText('Leave empty for https://privatusanalytics.com. Self-hosted instances must also be added to urlFetchWhitelist in appsscript.json.')
    .setPlaceholder(DEFAULT_BASE_URL);

  config.setDateRangeRequired(true);
  return config.build();
}

function siteIdFrom_(configParams) {
  var cfg = configParams || {};
  var id = String(cfg.site_id || '').trim() || String(cfg.site_select || '').trim();
  if (!id) throwUserError_('Choose a site (or enter its pa_… id) in the data source configuration.');
  return id;
}

function getData(request) {
  var cfg = request.configParams || {};
  var token = getToken_();
  if (!token) throwUserError_('Authorize the connector with a Privatus Analytics API token first.');

  var baseUrl = baseUrlFor_(cfg);
  var siteId = siteIdFrom_(cfg);
  var fieldNames = request.fields.map(function (f) { return f.name; });

  var plan, common;
  try {
    plan = planRequest(fieldNames);
    common = commonParams(cfg);
  } catch (e) {
    throwUserError_(e.message);
  }

  var site = getSite_(token, baseUrl, siteId);
  var ctx = { currency: site.currency };
  var period = periodParams(cfg.period, request.dateRange);
  var sitePath = '/sites/' + encodeURIComponent(siteId);
  var rows = [];

  if (plan.kind === 'aggregate') {
    var agg = apiGet_(token, baseUrl, sitePath + '/stats/aggregate.json', merge_(period, common));
    rows = aggregateToRows(agg.data, fieldNames, ctx);
  } else if (plan.kind === 'timeseries') {
    var ts = apiGet_(token, baseUrl, sitePath + '/stats/timeseries.json', merge_(period, common, { interval: 'day' }));
    rows = timeseriesToRows(ts.data, fieldNames, ctx);
  } else if (plan.kind === 'breakdown') {
    var path = sitePath + '/breakdown/' + encodeURIComponent(plan.dimension.api) + '.json';
    var pages = breakdownPages(cfg.max_rows);
    for (var i = 0; i < pages.length; i++) {
      var body = apiGet_(token, baseUrl, path, merge_(period, common, { page: pages[i].page, limit: pages[i].limit }));
      var apiRows = (body.data && body.data.rows) || [];
      rows = rows.concat(breakdownToRows(apiRows, fieldNames, plan.dimension, ctx));
      if (!hasMorePages(plan.dimension, apiRows, pages[i].limit)) break;
    }
  } else {
    rows = dailyBreakdown_(token, baseUrl, sitePath, plan.dimension, cfg, request.dateRange, common, fieldNames, ctx);
  }

  return { schema: schemaForFields(fieldNames, site.currency), rows: rows, filtersApplied: false };
}

/** Date + one dimension: one breakdown per day (parallel, capped). */
function dailyBreakdown_(token, baseUrl, sitePath, dimension, cfg, dateRange, common, fieldNames, ctx) {
  if (cfg.period && cfg.period !== 'report') {
    throwUserError_('Date combined with another dimension needs the "Report date range" period.');
  }
  if (!dateRange || !dateRange.startDate) throwUserError_('A date range is required.');
  var days = enumerateDays(dateRange.startDate, dateRange.endDate);
  if (days.length > MAX_DAYS_FOR_DAILY_BREAKDOWN) {
    throwUserError_('Date + ' + dimension.label + ' is limited to ' + MAX_DAYS_FOR_DAILY_BREAKDOWN +
      ' days. Shorten the date range or remove the Date dimension.');
  }
  var limit = Math.min(parseInt(cfg.max_rows, 10) || DEFAULT_ROWS_PER_DAY, MAX_PAGE_LIMIT);
  var path = sitePath + '/breakdown/' + encodeURIComponent(dimension.api) + '.json';
  var requests = days.map(function (day) {
    return { path: path, params: merge_({ period: 'custom', from: day, to: day }, common, { page: 1, limit: limit }) };
  });
  var bodies = apiGetAll_(token, baseUrl, requests);
  var rows = [];
  bodies.forEach(function (body, i) {
    rows = rows.concat(breakdownToRows((body.data && body.data.rows) || [], fieldNames, dimension, ctx, toYmd(days[i])));
  });
  return rows;
}

function merge_() {
  var out = {};
  for (var i = 0; i < arguments.length; i++) {
    var obj = arguments[i] || {};
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
  }
  return out;
}
