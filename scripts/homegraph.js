#!/usr/bin/env node
//
// Shows what Google HomeGraph knows about the devices of a user.
// Uses the service account from functions/settings.json (SERVICEACCOUNT, PRIVATE_KEY),
// the same credentials which are used for Report State and Request Sync.
//
//   node scripts/homegraph.js <agentUserId>                devices registered with Google (SYNC)
//   node scripts/homegraph.js <agentUserId> <id> [<id>]    stored states of the devices (QUERY)
//
// The agentUserId is shown in FHEM in the reading gassistant-fhem-uid (e.g. auth0|123...).
//
'use strict';

const path = require('path');
const functionsDir = path.join(__dirname, '..', 'functions');
const settings = require(path.join(functionsDir, 'settings.json'));
const jsonwt = require(path.join(functionsDir, 'node_modules', 'jsonwebtoken'));

const HOMEGRAPH = 'https://homegraph.googleapis.com/v1';

async function accessToken() {
  if (!settings.SERVICEACCOUNT || !settings.PRIVATE_KEY)
    throw new Error('SERVICEACCOUNT and PRIVATE_KEY missing in functions/settings.json');
  const assertion = jsonwt.sign({
    iss: settings.SERVICEACCOUNT,
    scope: 'https://www.googleapis.com/auth/homegraph',
    aud: 'https://accounts.google.com/o/oauth2/token'
  }, settings.PRIVATE_KEY, { algorithm: 'RS256', expiresIn: 3600 });
  const res = await fetch('https://accounts.google.com/o/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion })
  });
  const json = await res.json();
  if (!json.access_token)
    throw new Error('No access token from Google: ' + JSON.stringify(json));
  return json.access_token;
}

async function homegraph(method, body) {
  const res = await fetch(HOMEGRAPH + '/devices:' + method, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ requestId: String(Date.now()) }, body))
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error('HomeGraph ' + method + ' failed with ' + res.status + ': ' + text);
  return JSON.parse(text);
}

async function main() {
  const [agentUserId, ...ids] = process.argv.slice(2);
  if (!agentUserId) {
    console.error('Usage: node scripts/homegraph.js <agentUserId> [deviceId ...]');
    process.exit(1);
  }

  if (ids.length === 0) {
    const res = await homegraph('sync', { agentUserId: agentUserId });
    const devices = (res.payload && res.payload.devices) || [];
    console.log(devices.length + ' devices registered with Google for ' + agentUserId + ':');
    for (const d of devices) {
      console.log('  ' + d.id.padEnd(30) + ' ' + d.type.replace('action.devices.types.', '').padEnd(14) + ' ' +
        (d.name && d.name.name) + (d.willReportState ? '' : '  (willReportState: false)'));
    }
    return;
  }

  const res = await homegraph('query', {
    agentUserId: agentUserId,
    inputs: [{ payload: { devices: ids.map((id) => ({ id: id })) } }]
  });
  console.log(JSON.stringify(res.payload && res.payload.devices, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
