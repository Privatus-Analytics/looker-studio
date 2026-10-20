/**
 * HTTP access to the Privatus Analytics Management API (Bearer pat_… token).
 */

/** Default base URL: script property PRIVATUS_BASE_URL (self-hosted) or the cloud. */
function defaultBaseUrl_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('PRIVATUS_BASE_URL');
  return normalizeBaseUrl(fromProps || DEFAULT_BASE_URL);
}

function baseUrlFor_(configParams) {
  var custom = configParams && configParams.base_url;
  return custom ? normalizeBaseUrl(custom) : defaultBaseUrl_();
}

function requestOptions_(token) {
  return {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: false,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    }
  };
}

function throwUserError_(message, debugText) {
  DataStudioApp.createCommunityConnector()
    .newUserError()
    .setText(message)
    .setDebugText(debugText || message)
    .throwException();
}

function parseResponse_(response, url) {
  var status = response.getResponseCode();
  var text = response.getContentText();
  if (status < 200 || status >= 300) {
    throwUserError_(apiErrorMessage(status, text), 'GET ' + url.replace(/\?.*$/, '') + ' -> ' + status);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throwUserError_('Privatus Analytics returned an unexpected (non-JSON) response.', String(e));
  }
}

/** GET {base}{path}?params, returns the parsed JSON body ({data, meta}). */
function apiGet_(token, baseUrl, path, params) {
  var url = buildUrl(baseUrl, path, params);
  return parseResponse_(UrlFetchApp.fetch(url, requestOptions_(token)), url);
}

/** Parallel GETs; each request = {path, params}. Returns bodies in order. */
function apiGetAll_(token, baseUrl, requests) {
  var results = [];
  var BATCH = 10;
  for (var i = 0; i < requests.length; i += BATCH) {
    var slice = requests.slice(i, i + BATCH);
    var fetches = slice.map(function (r) {
      var opts = requestOptions_(token);
      opts.url = buildUrl(baseUrl, r.path, r.params);
      return opts;
    });
    var responses = UrlFetchApp.fetchAll(fetches);
    responses.forEach(function (resp, j) { results.push(parseResponse_(resp, fetches[j].url)); });
  }
  return results;
}

/** Site record (cached 6h per user + site) — used for its currency. */
function getSite_(token, baseUrl, siteId) {
  var cache = CacheService.getUserCache();
  var key = 'site:' + Utilities.base64EncodeWebSafe(baseUrl + '|' + siteId);
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  var body = apiGet_(token, baseUrl, '/sites/' + encodeURIComponent(siteId) + '.json');
  var site = { id: body.data.id, domain: body.data.domain, name: body.data.name, currency: body.data.currency, timezone: body.data.timezone };
  cache.put(key, JSON.stringify(site), 21600);
  return site;
}

/** Workspaces and their sites, for the site picker. Returns [] on failure. */
function listSiteOptions_(token, baseUrl) {
  try {
    var workspaces = apiGet_(token, baseUrl, '/workspaces.json').data || [];
    var sitesByWorkspace = {};
    workspaces.forEach(function (ws) {
      var all = [];
      for (var page = 1; page <= 10; page++) {
        var body = apiGet_(token, baseUrl, '/workspaces/' + encodeURIComponent(ws.id) + '/sites.json', { page: page, per_page: 100 });
        all = all.concat(body.data || []);
        var meta = body.meta || {};
        if (!meta.total_pages || page >= meta.total_pages) break;
      }
      sitesByWorkspace[ws.id] = all;
    });
    return siteOptions(workspaces, sitesByWorkspace);
  } catch (e) {
    return [];
  }
}
