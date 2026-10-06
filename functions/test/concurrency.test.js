'use strict';

// Concurrent requests in one instance (Cloud Run concurrency > 1) must not influence each other.
const test = require('node:test');
const assert = require('node:assert');

process.env.GCLOUD_PROJECT = 'demo-test';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'demo-test',
  databaseURL: 'https://demo-test-default-rtdb.firebaseio.com'
});

const utils = require('../utils');
const hquery = require('../handleQUERY');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lamp(name, state) {
  return {
    device: { name: name, uuid_base: name, mappings: { On: { device: name, reading: ['state'], characteristic_type: 'On' } } },
    readings: { state: state }
  };
}

test.after(async function () {
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

test('concurrent QUERY requests return their own devices', async function () {
  const orig = { all: utils.getAllDevicesAndReadings, single: utils.getDevicesAndReadings, cached: utils.cached2Format };
  const devices = {};
  for (let i = 0; i < 20; i++)
    devices['lamp' + i] = lamp('lamp' + i, i % 2 ? 'on' : 'off');
  // random delays force the requests to interleave at every await
  utils.getAllDevicesAndReadings = async () => { await sleep(Math.random() * 5); return devices; };
  utils.getDevicesAndReadings = async (uid, name) => { await sleep(Math.random() * 5); return { [name]: devices[name] }; };
  utils.cached2Format = async (uid, mapping, readings) => { await sleep(Math.random() * 5); return readings.state === 'on'; };
  try {
    const names = Object.keys(devices);
    const results = await Promise.all(names.map((name) => hquery.processQUERY('uid', {
      intent: 'action.devices.QUERY',
      payload: { devices: [{ id: name, customData: { device: name } }] }
    }, 0)));
    results.forEach(function (res, i) {
      assert.deepStrictEqual(Object.keys(res.devices), [names[i]], 'result of ' + names[i]);
      assert.strictEqual(res.devices[names[i]].on, i % 2 === 1, 'state of ' + names[i]);
    });
  } finally {
    utils.getAllDevicesAndReadings = orig.all;
    utils.getDevicesAndReadings = orig.single;
    utils.cached2Format = orig.cached;
  }
});

test('processQUERY works in the client, whose utils have no getDevicesAndReadings', async function () {
  // as in the client (lib/localhandleQUERY.js): source code evaluated with the client utils
  const clientUtils = {
    getAllDevicesAndReadings: async () => ({ lamp: lamp('lamp', 'on') }),
    cached2Format: async (uid, mapping, readings) => readings.state === 'on'
  };
  const errors = [];
  const processQUERY = new Function('utils', 'uidlog', 'uiderror',
    'return (' + hquery.processQUERY.toString() + ')')(clientUtils, () => {}, (uid, msg) => errors.push(msg));
  const res = await processQUERY('uid', {
    intent: 'action.devices.QUERY',
    payload: { devices: [{ id: 'lamp', customData: { device: 'lamp' } }] }
  }, 1);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(res.devices.lamp.on, true);
});
