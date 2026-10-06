'use strict';

// Report state timing of readings, the function is executed in the client
const test = require('node:test');
const assert = require('node:assert');

process.env.GCLOUD_PROJECT = 'demo-test';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-test', databaseURL: 'https://demo-test-default-rtdb.firebaseio.com' });

// as in the client: source code is sent and evaluated
const compareFunction = eval('(' + require('../clientapi').reportStateCompareFunction.toString() + ')');

test.after(async function () {
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

// FHEM_update of the client (lib/fhem.js) for one device
function client(reports) {
  const store = {};
  const report = (d) => reports.push(d);
  return function update(reading, value) {
    const dev = store.dev || (store.dev = {});
    const s = store[reading] || (store[reading] = {});
    s.cancelOldTimeout = !s.oldValue
      ? compareFunction('', 0, value, undefined, 0, undefined, report, reading + '=' + value)
      : compareFunction(s.oldValue, s.oldTimestamp, value, s.cancelOldTimeout, dev.oldTimestamp, dev.cancelOldTimeout, report, reading + '=' + value);
    if (s.cancelOldTimeout) {
      dev.cancelOldTimeout = s.cancelOldTimeout;
      dev.oldTimestamp = Date.now();
    }
    s.oldValue = value;
    s.oldTimestamp = Date.now();
  };
}

test('a single change is reported after 1s', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const reports = [];
  const update = client(reports);
  update('state', 'off');
  t.mock.timers.tick(60000);
  reports.length = 0;
  update('state', 'on');
  t.mock.timers.tick(1000);
  assert.deepStrictEqual(reports, ['state=on']);
  // same value again: nothing
  update('state', 'on');
  t.mock.timers.tick(20000);
  assert.deepStrictEqual(reports, ['state=on']);
});

test('a reading changing every second is reported when it is stable', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const reports = [];
  const update = client(reports);
  update('pct', '0');
  t.mock.timers.tick(60000);
  reports.length = 0;
  for (let i = 1; i <= 60; i++) {
    update('pct', String(i));
    t.mock.timers.tick(1000);
  }
  // only the first change
  assert.deepStrictEqual(reports, ['pct=1']);
  t.mock.timers.tick(9000);
  assert.deepStrictEqual(reports, ['pct=1', 'pct=60']);
});

test('a flapping reading does not delay another reading of the device', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const reports = [];
  const update = client(reports);
  update('state', 'off');
  update('power', '0');
  t.mock.timers.tick(60000);
  reports.length = 0;
  update('state', 'on');
  for (let i = 1; i <= 30; i++) {
    t.mock.timers.tick(300);
    update('power', String(i));
  }
  assert.ok(reports.length >= 1 && reports.length <= 2, JSON.stringify(reports));
  assert.ok(reports[0] === 'state=on' || reports[0] === 'power=1', JSON.stringify(reports));
});
