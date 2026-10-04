// Creates the HTTP functions as 1st gen (Cloud Functions) or 2nd gen (Cloud Run functions).
// The generation of each function is configured in generations.json, so the functions can be
// upgraded one after another (gcloud functions upgrade) and the code follows afterwards.
const config = require('./generations.json');

function generation(name) {
  return (config.functions && config.functions[name]) === 2 ? 2 : 1;
}

function onRequest(name, region, app) {
  if (generation(name) === 2) {
    const { onRequest } = require('firebase-functions/v2/https');
    const concurrency = config.concurrency || 1;
    return onRequest({
      region: region,
      invoker: 'public',
      concurrency: concurrency,
      // concurrency > 1 requires at least 1 vCPU, otherwise use the 1st gen CPU allocation
      cpu: concurrency > 1 ? 1 : 'gcf_gen1'
    }, app);
  }
  const functions = require('firebase-functions/v1');
  return functions.region(region).https.onRequest(app);
}

module.exports = {
  onRequest,
  generation
};
