'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.GCLOUD_PROJECT = 'demo-test';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-test', databaseURL: 'https://demo-test-default-rtdb.firebaseio.com' });

const firebase = require('../firebase');
const utils = require('../utils');

test.after(async function () {
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

test('EXECUTE commands are sent to FHEM via Firestore', async function () {
  const written = [];
  const orig = firebase.getFirestore;
  firebase.getFirestore = () => ({
    collection: (uid) => ({
      doc: (doc) => ({
        collection: (col) => ({
          add: async (data) => { written.push({ path: uid + '/' + doc + '/' + col, data }); }
        })
      })
    })
  });
  try {
    await utils.sendCmd2Fhem('uid', { 'http://fhem:8083/fhem': 'set lamp on;set lamp2 off' });
  } finally {
    firebase.getFirestore = orig;
  }
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0].path, 'uid/msgs/firestore2fhem');
  assert.strictEqual(written[0].data.msg, 'EXECUTE');
  assert.strictEqual(written[0].data.cmd, 'set lamp on;set lamp2 off');
  assert.strictEqual(written[0].data.connection, 'http://fhem:8083/fhem');
});
