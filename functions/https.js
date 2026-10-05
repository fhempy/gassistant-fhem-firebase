// Creates the HTTP functions. How each function is deployed is configured in generations.json:
//   1      1st gen Cloud Function, deployed with "firebase deploy"
//   2      2nd gen Cloud Function (Cloud Run functions), deployed with "firebase deploy"
//   "run"  upgraded with "gcloud functions upgrade": a Cloud Run service which Firebase can't
//          manage. It is exported as plain HTTP handler (invisible for "firebase deploy") and
//          deployed with "gcloud run deploy --function <name>" (scripts/deploy.sh).
const config = require('./generations.json');

function generation(name) {
  const gen = config.functions && config.functions[name];
  if (gen === 2 || gen === 'run')
    return gen;
  return 1;
}

// names of the functions deployed with gcloud run deploy
function cloudRunFunctions() {
  return Object.keys(config.functions || {}).filter((name) => generation(name) === 'run');
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
  const gen = generation(name);
  if (gen === 'run') {
    // plain handler for the Functions Framework, without Firebase metadata
    return handler;
  }
  if (gen === 2) {
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
  cloudRunFunctions,
  stripFunctionName
};
