/**
 * getSchema: the field catalogue lives in Transform.gs (buildSchema) so it
 * can be unit-tested; revenue gets the site currency as its semantic type.
 */

function siteCurrency_(configParams) {
  try {
    var token = getToken_();
    if (!token) return null;
    return getSite_(token, baseUrlFor_(configParams), siteIdFrom_(configParams)).currency;
  } catch (e) {
    return null;
  }
}

function getSchema(request) {
  var currency = siteCurrency_(request.configParams);
  return { schema: buildSchema(currency) };
}
