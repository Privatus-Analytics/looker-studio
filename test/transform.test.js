'use strict';
// Loads Transform.gs into a vm context (as Apps Script would) and tests the
// response -> rows mapping. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const ctx = vm.createContext({});
  const code = fs.readFileSync(path.join(__dirname, '..', 'Transform.gs'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'Transform.gs' });
  return ctx;
}
const T = load();
// vm objects come from another realm; normalise before deepEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('manifest is valid JSON with the dataStudio block', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
  assert.equal(m.dataStudio.company, 'Privatus Analytics');
  assert.ok(m.urlFetchWhitelist.includes('https://privatusanalytics.com/'));
  assert.ok(m.oauthScopes.includes('https://www.googleapis.com/auth/script.external_request'));
});

test('planRequest picks the endpoint', () => {
  assert.deepEqual(plain(T.planRequest(['visitors'])), { kind: 'aggregate' });
  assert.deepEqual(plain(T.planRequest(['date', 'visitors'])), { kind: 'timeseries' });
  const b = T.planRequest(['country', 'visits']);
  assert.equal(b.kind, 'breakdown');
  assert.equal(b.dimension.api, 'country');
  assert.equal(T.planRequest(['source', 'visitors']).dimension.api, 'referrer');
  assert.equal(T.planRequest(['event_name', 'events']).dimension.api, 'event');
  assert.equal(T.planRequest(['visitors', 'date', 'device']).kind, 'daily_breakdown');
  assert.throws(() => T.planRequest(['country', 'device']), /one dimension/);
  assert.throws(() => T.planRequest(['nope']), /Unknown field/);
});

test('periodParams maps the report date range to custom', () => {
  assert.deepEqual(plain(T.periodParams('report', { startDate: '2026-09-01', endDate: '2026-09-28' })),
    { period: 'custom', from: '2026-09-01', to: '2026-09-28' });
  assert.deepEqual(plain(T.periodParams(undefined, { startDate: '2026-09-01', endDate: '2026-09-02' })).period, 'custom');
  assert.deepEqual(plain(T.periodParams('7d', { startDate: '2026-09-01', endDate: '2026-09-28' })), { period: '7d' });
  assert.deepEqual(plain(T.periodParams('bogus', null)), { period: '30d' });
});

test('commonParams validates filters JSON', () => {
  assert.deepEqual(plain(T.commonParams({ filters: ' [["page","starts_with","/blog"]] ', segment_id: 'seg_1' })),
    { filters: '[["page","starts_with","/blog"]]', segment_id: 'seg_1' });
  assert.throws(() => T.commonParams({ filters: '{nope' }), /JSON array/);
  assert.deepEqual(plain(T.commonParams({})), {});
});

test('buildUrl encodes params and trims the base', () => {
  assert.equal(T.buildUrl('https://privatusanalytics.com/', '/sites/pa_1/breakdown/page.json', { period: 'custom', from: '2026-09-01', filters: '[["a","is","b c"]]', empty: '' }),
    'https://privatusanalytics.com/sites/pa_1/breakdown/page.json?period=custom&from=2026-09-01&filters=%5B%5B%22a%22%2C%22is%22%2C%22b%20c%22%5D%5D');
  assert.throws(() => T.buildUrl('http://x', '/a'), /https/);
});

test('timeseries -> rows in requested field order with unit conversion', () => {
  const data = {
    period: { from: '2026-09-01T00:00:00Z', to: '2026-09-03T00:00:00Z' }, interval: 'day',
    series: [
      { date: '2026-09-01T00:00:00Z', visitors: 10, visits: 12, pageviews: 30, views_per_visit: 2.5, bounce_rate: 41.7, visit_duration: 65400, revenue: 4999 },
      { date: '2026-09-02T00:00:00Z', visitors: 0, visits: 0, pageviews: 0, views_per_visit: 0.0, bounce_rate: 0.0, visit_duration: 0, revenue: 0 }
    ]
  };
  const rows = plain(T.timeseriesToRows(data, ['visitors', 'date', 'bounce_rate', 'visit_duration', 'revenue', 'events'], { currency: 'USD' }));
  assert.deepEqual(rows, [
    { values: [10, '20260901', 0.417, 65, 49.99, null] },
    { values: [0, '20260902', 0, 0, 0, null] }
  ]);
});

test('revenue respects zero-decimal currencies', () => {
  const rows = plain(T.aggregateToRows({ metrics: { revenue: 1500, visitors: 3 } }, ['revenue', 'visitors'], { currency: 'JPY' }));
  assert.deepEqual(rows, [{ values: [1500, 3] }]);
});

test('visit breakdown -> rows', () => {
  const dim = T.findDimension('country');
  const apiRows = [
    { value: 'DE', visitors: 5, visits: 6, pageviews: 9, views_per_visit: 1.5, bounce_rate: 50.0, visit_duration: 1000, revenue: 0, share: 62.5 },
    { value: 'FR', visitors: 3, visits: 3, pageviews: 3, views_per_visit: 1.0, bounce_rate: 100.0, visit_duration: 0, revenue: 250, share: 37.5 }
  ];
  const rows = plain(T.breakdownToRows(apiRows, ['country', 'visitors', 'share', 'revenue'], dim, { currency: 'EUR' }));
  assert.deepEqual(rows, [
    { values: ['DE', 5, 0.625, 0] },
    { values: ['FR', 3, 0.375, 2.5] }
  ]);
});

test('page breakdown has page metrics, visit-only metrics are null', () => {
  const dim = T.findDimension('page');
  const apiRows = [{ value: '/pricing', pageviews: 40, visits: 30, time_on_page: 42000, scroll_depth: 75, share: 100 }];
  const rows = plain(T.breakdownToRows(apiRows, ['page', 'pageviews', 'time_on_page', 'scroll_depth', 'visitors', 'bounce_rate'], dim, {}));
  assert.deepEqual(rows, [{ values: ['/pricing', 40, 42, 0.75, null, null] }]);
});

test('event and goal breakdowns map events/conversions', () => {
  const ev = T.findDimension('event_name');
  assert.deepEqual(plain(T.breakdownToRows([{ value: 'signup', completions: 12, visits: 10, revenue: 0, conversion_rate: 4.25, share: 100 }],
    ['event_name', 'events', 'conversions', 'conversion_rate'], ev, {})), [{ values: ['signup', 12, 10, 0.0425] }]);
  const goal = T.findDimension('goal');
  assert.deepEqual(plain(T.breakdownToRows([{ value: 'Purchase', goal_id: 'goal_1', completions: 4, conversions: 3, conversion_rate: 1.5, revenue: 19900, share: 100 }],
    ['goal', 'conversions', 'revenue', 'visitors'], goal, { currency: 'GBP' })), [{ values: ['Purchase', 3, 199, null] }]);
});

test('daily breakdown rows carry the date', () => {
  const dim = T.findDimension('device');
  const rows = plain(T.breakdownToRows([{ value: 'Mobile', visitors: 2 }], ['date', 'device', 'visitors'], dim, {}, T.toYmd('2026-09-05')));
  assert.deepEqual(rows, [{ values: ['20260905', 'Mobile', 2] }]);
  assert.deepEqual(plain(T.enumerateDays('2026-02-27', '2026-03-02')), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});

test('paging helpers', () => {
  assert.deepEqual(plain(T.breakdownPages(undefined)), [{ page: 1, limit: 1000 }]);
  assert.deepEqual(plain(T.breakdownPages('250')), [{ page: 1, limit: 250 }]);
  assert.equal(T.breakdownPages(2500).length, 3);
  assert.equal(T.breakdownPages(999999).length, 10);
  assert.equal(T.hasMorePages(T.findDimension('page'), new Array(1000), 1000), true);
  assert.equal(T.hasMorePages(T.findDimension('page'), new Array(3), 1000), false);
  assert.equal(T.hasMorePages(T.findDimension('goal'), new Array(1000), 1000), false);
});

test('schema: semantics and currency', () => {
  const schema = plain(T.buildSchema('EUR'));
  const byName = Object.fromEntries(schema.map((f) => [f.name, f]));
  assert.equal(byName.date.semantics.semanticType, 'YEAR_MONTH_DAY');
  assert.equal(byName.country.semantics.semanticType, 'COUNTRY_CODE');
  assert.equal(byName.revenue.semantics.semanticType, 'CURRENCY_EUR');
  assert.equal(byName.bounce_rate.semantics.semanticType, 'PERCENT');
  assert.equal(byName.bounce_rate.semantics.isReaggregatable, false);
  assert.equal(byName.visitors.defaultAggregationType, 'SUM');
  assert.equal(plain(T.buildSchema(null)).find((f) => f.name === 'revenue').semantics.semanticType, 'NUMBER');
  assert.deepEqual(plain(T.schemaForFields(['visits', 'date'], 'USD')).map((f) => f.name), ['visits', 'date']);
});

test('siteOptions labels and apiErrorMessage', () => {
  const opts = plain(T.siteOptions([{ id: 'ws_1', name: 'Acme' }], { ws_1: [{ id: 'pa_1', domain: 'acme.com', name: 'Acme site' }, { id: 'pa_2', domain: 'b.com', name: 'b.com' }] }));
  assert.deepEqual(opts, [{ label: 'Acme site (acme.com)', value: 'pa_1' }, { label: 'b.com', value: 'pa_2' }]);
  assert.match(T.apiErrorMessage(401, '{"error":{"code":"unauthorized","message":"Invalid token"}}'), /rejected the API token.*Invalid token \(unauthorized\)/);
  assert.equal(T.apiErrorMessage(500, 'oops'), 'Privatus Analytics API error: HTTP 500');
});
