'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const config = require('../generations.json');
const https = require('../https');

test('all functions are 1st gen by default', function () {
  for (const name of ['api', 'reportstate', 'dynamicfunctionsv1', 'codelanding', 'firebase', 'admin'])
    assert.strictEqual(https.generation(name), 1, name);
});

test('generation is selected per function', function () {
  const saved = JSON.parse(JSON.stringify(config));
  try {
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
