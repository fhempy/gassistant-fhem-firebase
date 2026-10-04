// Creates the HTTP functions as 1st gen (Cloud Functions) or 2nd gen (Cloud Run functions).
// The generation of each function is configured in generations.json, so the functions can be
// switched one after another (see scripts/migrate-functions.sh).
const config = require('./generations.json');

function generation(name) {
  return (config.functions && config.functions[name]) === 2 ? 2 : 1;
}

// 1st gen cloudfunctions.net URLs remove the function name from the path
// (/codelanding/start -> /start), Cloud Run services receive the full path.
// Accept both, so the routes work independent of how the function is hosted.
function stripFunctionName(name, app) {
  const prefix = '/' + name;
  return function (req, res) {
    if (req.url === prefix || req.url.startsWith(prefix + '/') || req.url.startsWith(prefix + '?')) {
      const rest = req.url.slice(prefix.length);
      req.url = rest.startsWith('/') ? rest : '/' + rest;
    }
    return app(req, res);
  };
}

function onRequest(name, region, app) {
  const handler = stripFunctionName(name, app);
  if (generation(name) === 2) {
    const { onRequest } = require('firebase-functions/v2/https');
    const concurrency = config.concurrency || 1;
    return onRequest({
      region: region,
      invoker: 'public',
      concurrency: concurrency,
      // concurrency > 1 requires at least 1 vCPU, otherwise use the 1st gen CPU allocation
      cpu: concurrency > 1 ? 1 : 'gcf_gen1'
    }, handler);
  }
  const functions = require('firebase-functions/v1');
  return functions.region(region).https.onRequest(handler);
}

module.exports = {
  onRequest,
  generation,
  stripFunctionName
};
