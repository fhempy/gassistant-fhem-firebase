'use strict';

// Loads the functions like Cloud Functions does and calls the HTTP endpoints with real
// Auth0-like RS256 tokens (local JWKS server). No Firebase backend is contacted.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const jsonwt = require('jsonwebtoken');

process.env.GCLOUD_PROJECT = 'demo-test';
// no connection to a real backend, unused emulator ports
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:9';
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'demo-test',
  databaseURL: 'https://demo-test-default-rtdb.firebaseio.com'
});

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'test-key', use: 'sig', alg: 'RS256' });

let jwksServer;
let functions;
let issuer;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test.before(async function () {
  jwksServer = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  issuer = 'http://127.0.0.1:' + await listen(jwksServer);

  // settings.json is shared via the require cache, configure it before loading the functions
  const settings = require('../settings.json');
  settings.AUTH0_DOMAIN = issuer;
  settings.AUDIENCE_URI = 'https://audience.test/';
  settings.AUTH0_LOGIN_DOMAIN = 'login.test';
  settings.AUTH0_WEB_CLIENTID = 'client';
  settings.AUTH0_WEB_CLIENTSECRET = 'secret';
  settings.AUTH0_CALLBACK_URL = 'https://callback.test/';
  settings.COOKIE_SECRET = 'cookie';

  functions = require('../index.js');
});

test.after(async function () {
  jwksServer.close();
  const { getApps, deleteApp } = require('firebase-admin/app');
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

function token(sub) {
  return jsonwt.sign({ sub: sub }, privateKey, {
    algorithm: 'RS256',
    keyid: 'test-key',
    issuer: issuer + '/',
    audience: 'https://audience.test/',
    expiresIn: 60
  });
}

async function call(fn, path, options) {
  const server = http.createServer(fn);
  const port = await listen(server);
  try {
    const res = await fetch('http://127.0.0.1:' + port + path, options);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch (e) { body = text; }
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

test('all functions are exported', function () {
  for (const name of ['api', 'reportstate', 'dynamicfunctionsv1', 'codelanding', 'firebase', 'admin'])
    assert.strictEqual(typeof functions[name], 'function', name);
});

test('requests without token are rejected', async function () {
  const res = await call(functions.api, '/getconfiguration');
  assert.strictEqual(res.status, 401);
});

test('requests with invalid token are rejected', async function () {
  const wrongKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const bad = jsonwt.sign({ sub: 'user1' }, wrongKey, { algorithm: 'RS256', keyid: 'test-key', issuer: issuer + '/', audience: 'https://audience.test/' });
  const res = await call(functions.api, '/getconfiguration', { headers: { Authorization: 'Bearer ' + bad } });
  assert.strictEqual(res.status, 401);
});

test('authenticated requests reach the handler with req.user', async function () {
  const auth = { headers: { Authorization: 'Bearer ' + token('auth0|user1') } };
  const config = await call(functions.api, '/getconfiguration', auth);
  assert.strictEqual(config.status, 200);
  assert.ok(config.body.devicetypes.includes('light'));

  const fl = await call(functions.api, '/getfeaturelevel', auth);
  assert.strictEqual(fl.status, 200);
  assert.strictEqual(typeof fl.body.featurelevel, 'number');

  const fcts = await call(functions.dynamicfunctionsv1, '/4.0/gethandleQUERY', auth);
  assert.strictEqual(fcts.status, 200);
  assert.match(fcts.body['exports.processQUERY'], /processQUERY/);
});

test('smarthome rejects invalid requests', async function () {
  const res = await call(functions.api, '/smarthome', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token('auth0|user1'), 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: '1' })
  });
  assert.strictEqual(res.status, 400);
});

test('codelanding shows the auth code', async function () {
  const res = await call(functions.codelanding, '/start?code=abc');
  assert.strictEqual(res.status, 200);
  assert.match(res.body, /abc/);
});
