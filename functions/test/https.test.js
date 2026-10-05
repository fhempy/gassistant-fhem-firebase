'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const config = require('../generations.json');
const https = require('../https');

// generations.json changes during the migration, only check that it is valid
test('generations.json configures all functions', function () {
  for (const name of ['api', 'reportstate', 'dynamicfunctionsv1', 'codelanding', 'firebase', 'admin']) {
    assert.ok([1, 2, 'run'].includes(config.functions[name]), name);
    assert.strictEqual(https.generation(name), config.functions[name], name);
  }
  assert.ok(Number.isInteger(config.concurrency) && config.concurrency >= 1);
});

test('generation is selected per function', function () {
  const saved = JSON.parse(JSON.stringify(config));
  try {
    // independent of the current generations.json
    config.concurrency = 1;
    config.functions = { api: 1, reportstate: 1, dynamicfunctionsv1: 1, codelanding: 1, firebase: 1, admin: 1 };
    config.functions.codelanding = 2;
    const gen2 = https.onRequest('codelanding', 'europe-west1', express());
    assert.strictEqual(gen2.__endpoint.platform, 'gcfv2');
    assert.deepStrictEqual(gen2.__endpoint.region, ['europe-west1']);
    assert.deepStrictEqual(gen2.__endpoint.httpsTrigger.invoker, ['public']);
    assert.strictEqual(gen2.__endpoint.concurrency, 1);

    config.concurrency = 80;
    const gen2c = https.onRequest('codelanding', 'europe-west1', express());
    assert.strictEqual(gen2c.__endpoint.concurrency, 80);
    assert.strictEqual(gen2c.__endpoint.cpu, 1);

    const gen1 = https.onRequest('api', 'europe-west1', express());
    assert.strictEqual(gen1.__endpoint.platform, 'gcfv1');
    assert.deepStrictEqual(gen1.__endpoint.region, ['europe-west1']);
  } finally {
    config.concurrency = saved.concurrency;
    config.functions = saved.functions;
  }
});

test('routes work with and without the function name in the path', async function () {
  const http = require('http');
  const app = express();
  app.get('/start', (req, res) => res.send('code ' + req.query.code));
  app.get('/', (req, res) => res.send('root'));
  const server = http.createServer(https.stripFunctionName('codelanding', app));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/start?code=a', '/codelanding/start?code=a'])
      assert.strictEqual(await (await fetch(base + path)).text(), 'code a', path);
    for (const path of ['/', '/codelanding', '/codelanding?x=1'])
      assert.strictEqual(await (await fetch(base + path)).text(), 'root', path);
    // other paths starting with the name are not changed
    assert.strictEqual((await fetch(base + '/codelandingx/start')).status, 404);
  } finally {
    server.close();
  }
});

test('"run" functions are plain handlers, invisible for firebase deploy', async function () {
  const saved = JSON.parse(JSON.stringify(config));
  try {
    config.functions = { api: 1, reportstate: 1, dynamicfunctionsv1: 1, codelanding: 1, firebase: 1, admin: 1 };
    config.functions.api = 'run';
    const app = express();
    app.get('/getfeaturelevel', (req, res) => res.send('ok'));
    const handler = https.onRequest('api', 'europe-west1', app);
    assert.strictEqual(handler.__endpoint, undefined);
    assert.deepStrictEqual(https.cloudRunFunctions(), ['api']);

    const http = require('http');
    const server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      assert.strictEqual(await (await fetch(base + '/api/getfeaturelevel')).text(), 'ok');
      assert.strictEqual(await (await fetch(base + '/getfeaturelevel')).text(), 'ok');
    } finally {
      server.close();
    }
  } finally {
    config.functions = saved.functions;
  }
});
