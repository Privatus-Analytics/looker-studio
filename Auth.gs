/**
 * KEY auth: the user pastes a Privatus Analytics API token (pat_…). It is stored in
 * this user's PropertiesService user properties (never shared with other
 * report viewers' credentials, never logged).
 */

var TOKEN_PROPERTY = 'privatus.api_token';

function getAuthType() {
  var cc = DataStudioApp.createCommunityConnector();
  return cc.newAuthTypeResponse()
    .setAuthType(cc.AuthType.KEY)
    .setHelpUrl('https://privatusanalytics.com/docs/api#tokens')
    .build();
}

function getToken_() {
  return PropertiesService.getUserProperties().getProperty(TOKEN_PROPERTY);
}

/** Checks a token with GET /workspaces.json (cheap, needs only a valid token). */
function validateToken_(token) {
  if (!token || !/^pat_[A-Za-z0-9_\-]+$/.test(token)) return false;
  try {
    var response = UrlFetchApp.fetch(buildUrl(defaultBaseUrl_(), '/workspaces.json'), requestOptions_(token));
    return response.getResponseCode() === 200;
  } catch (e) {
    return false;
  }
}

function isAuthValid() {
  return validateToken_(getToken_());
}

function setCredentials(request) {
  var token = request && request.key ? String(request.key).trim() : '';
  if (!validateToken_(token)) {
    return { errorCode: 'INVALID_CREDENTIALS' };
  }
  PropertiesService.getUserProperties().setProperty(TOKEN_PROPERTY, token);
  return { errorCode: 'NONE' };
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty(TOKEN_PROPERTY);
}

function isAdminUser() {
  return false;
}
