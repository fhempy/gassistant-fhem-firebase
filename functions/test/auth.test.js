'use strict';

// Verification of the Auth0 access tokens (replaces express-jwt/jwks-rsa)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const jsonwt = require('jsonwebtoken');
const { createJwtCheck } = require('../auth');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', use: 'sig', alg: 'RS256' });

let jwksServer;
let jwksRequests = 0;
let jwksStatus = 200;
let issuer;
const audience = 'https://audience.test/';

test.before(async function () {
  jwksServer = http.createServer((req, res) => {
    jwksRequests++;
    res.statusCode = jwksStatus;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  issuer = 'http://127.0.0.1:' + jwksServer.address().port + '/';
});

test.after(function () {
  jwksServer.close();
});

function check() {
  return createJwtCheck({ jwksUri: issuer + '.well-known/jwks.json', audience: audience, issuer: issuer });
}

function sign(options, key) {
  return jsonwt.sign({ sub: 'auth0|1' }, key || privateKey, Object.assign({
    algorithm: 'RS256', keyid: 'k1', issuer: issuer, audience: audience, expiresIn: 60
  }, options));
}

async function run(jwtCheck, authorization) {
  const req = { headers: authorization ? { authorization: authorization } : {} };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } };
  let nextCalled = false;
  await jwtCheck(req, res, () => { nextCalled = true; });
  return { status: res.statusCode, body: res.body, next: nextCalled, user: req.user };
}

test('valid token', async function () {
  const r = await run(check(), 'Bearer ' + sign());
  assert.strictEqual(r.next, true);
  assert.strictEqual(r.user.sub, 'auth0|1');
});

test('keys are fetched once', async function () {
  const jwtCheck = check();
  const before = jwksRequests;
  for (let i = 0; i < 5; i++)
    assert.strictEqual((await run(jwtCheck, 'Bearer ' + sign())).next, true);
  assert.strictEqual(jwksRequests - before, 1);
});

test('missing or malformed authorization header', async function () {
  assert.strictEqual((await run(check())).status, 401);
  assert.strictEqual((await run(check(), 'Basic abc')).status, 401);
  assert.strictEqual((await run(check(), 'Bearer not-a-token')).status, 401);
});

test('rejected tokens', async function () {
  const jwtCheck = check();
  const cases = {
    expired: sign({ expiresIn: -10 }),
    'wrong audience': sign({ audience: 'https://other/' }),
    'wrong issuer': sign({ issuer: 'https://evil/' }),
    'wrong key': sign({}, other.privateKey),
    'unknown key id': sign({ keyid: 'k2' }),
    'no key id': jsonwt.sign({ sub: 'auth0|1' }, privateKey, { algorithm: 'RS256', issuer: issuer, audience: audience }),
    'HS256 with the public key': jsonwt.sign({ sub: 'auth0|1' }, 'secret', { algorithm: 'HS256', keyid: 'k1', issuer: issuer, audience: audience }),
    'alg none': [Buffer.from('{"alg":"none","kid":"k1"}').toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'auth0|1', iss: issuer, aud: audience })).toString('base64url'), ''].join('.')
  };
  for (const [name, token] of Object.entries(cases)) {
    const r = await run(jwtCheck, 'Bearer ' + token);
    assert.strictEqual(r.status, 401, name);
    assert.strictEqual(r.next, false, name);
    assert.strictEqual(r.user, undefined, name);
  }
});

test('unknown key ids fetch the keys at most once per minute', async function () {
  const jwtCheck = check();
  await run(jwtCheck, 'Bearer ' + sign());
  const before = jwksRequests;
  for (let i = 0; i < 5; i++)
    await run(jwtCheck, 'Bearer ' + sign({ keyid: 'rotated' }));
  assert.strictEqual(jwksRequests, before);
});

test('Auth0 not reachable is not reported as invalid token', async function () {
  jwksStatus = 500;
  try {
    const r = await run(check(), 'Bearer ' + sign());
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.next, false);
  } finally {
    jwksStatus = 200;
  }
});
