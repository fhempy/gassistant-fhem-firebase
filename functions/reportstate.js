const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const utils = require('./utils');
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const hquery = require('./handleQUERY');

const app3 = express();
app3.use(cors());
app3.use(bodyParser.json());
app3.use(bodyParser.urlencoded({extended: true}));
app3.use(utils.jwtCheck);
app3.use(function(req, res, next) {
  const {sub: uid} = req.user;
  uidlog(uid, 'Function called: ' + req.originalUrl);
  next();
});

app3.post('/singledevice', async (req, res) => {
  const {sub: uid} = req.user;
  const device = req.body.device;

  //reportstate
  await utils.reportState(uid, device);
  res.send({});
});

app3.get('/alldevices', async (req, res) => {
  const {sub: uid} = req.user;
  uidlog(uid, 'REPORT STATE ALL');
  
  var query = {
      intent: 'action.devices.QUERY',
      payload: {
        devices: []
      }
  };
  var devices = await utils.loadDevices(uid);
  for (var de in devices) {
    const d = devices[de];
    query.payload.devices.push({
      id: d.uuid_base,
      customData: {
        device: d.uuid_base
      }
    });
  }
  const reportstate = 1;
  var deviceQueryRes = await hquery.processQUERY(uid, query, reportstate);
  
  //prepare response
  var dev = {
    requestId: (Math.floor(Math.random() * Math.floor(1000000000000))).toString(),
    agentUserId: uid,
    payload: {
      devices: {
        states: {}
      }
    }
  };
  dev.payload.devices.states = deviceQueryRes.devices;
  
  uidlog(uid, 'device query res: ' + JSON.stringify(dev));

  //TODO check if token is already older than one hour and renew it if so
  var google_token = await utils.getGoogleToken();
  if (!google_token)
    google_token = await utils.retrieveGoogleToken(uid);
    
  uidlog(uid, 'google token: ' + await google_token);
  
  //report state
  for (var i=0; i<2; i++) {
    var options = { method: 'POST',
      headers: {
        Authorization: 'Bearer ' + google_token,
        'X-GFE-SSL': 'yes',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dev)
    };
    const reportStateRes = await fetch('https://homegraph.googleapis.com/v1/devices:reportStateAndNotification', options);
    uidlog(uid, 'reportstateres: ' + await reportStateRes.status);
    
    if (reportStateRes.status == 401) {
      google_token = await utils.retrieveGoogleToken(uid);
    } else {
      //save the token to database
      utils.setGoogleToken(google_token);
      break;
    }
  }
  res.send({});
});


const reportstate = functions.region('europe-west1').https.onRequest(app3);

module.exports = {
  reportstate
};
