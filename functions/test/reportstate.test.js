'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.GCLOUD_PROJECT = 'demo-test';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-test', databaseURL: 'https://demo-test-default-rtdb.firebaseio.com' });

const utils = require('../utils');

test.after(async function () {
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

function report(states) {
  return { requestId: '1', agentUserId: 'uid', payload: { devices: { states: states } } };
}

test('QUERY results are cleaned for HomeGraph', function () {
  const res = utils.sanitizeReportState('uid', report({
    lamp: { on: true, brightness: NaN, online: true, status: 'SUCCESS', color: {} },
    heater: { thermostatTemperatureAmbient: 21.5, humidityAmbientPercent: undefined, status: 'SUCCESS', currentStatusReport: [] },
    broken: { status: 'ERROR', errorCode: 'deviceOffline' },
    // result of the former bug devices.status = "SUCCESS"
    status: 'SUCCESS'
  }));
  assert.deepStrictEqual(res.payload.devices.states, {
    lamp: { on: true, online: true },
    heater: { thermostatTemperatureAmbient: 21.5 }
  });
  assert.strictEqual(res.agentUserId, 'uid');
  assert.strictEqual(res.requestId, '1');
});

test('nothing to report returns undefined', function () {
  assert.strictEqual(utils.sanitizeReportState('uid', report({ x: { status: 'ERROR', errorCode: 'e' } })), undefined);
  assert.strictEqual(utils.sanitizeReportState('uid', report({})), undefined);
  assert.strictEqual(utils.sanitizeReportState('uid', {}), undefined);
});
