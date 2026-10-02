const functions = require("firebase-functions/v1");
const utils = require('./utils');
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const settings = require('./settings.json');

var clientConnectionOk = {};

// Name of the function served by this instance. Only the required modules are loaded,
// during deployment (no target set) all functions are exported.
const FUNCTION_TARGET = process.env.FUNCTION_TARGET || process.env.K_SERVICE;

function isTarget(name) {
  return !FUNCTION_TARGET || FUNCTION_TARGET === name;
}

async function checkClientConnection(uid) {
  var connectionOk = 0;
  try {
    var clientstate = await utils.getRealDB().ref('/users/' + uid + '/heartbeat').once('value');
    uidlog(uid, 'check client connection: ' + JSON.stringify(clientstate.val()));
    if ((clientstate.val() && clientstate.val().active && (clientstate.val().time + 65000) > Date.now()) || clientstate.val() === null) {
      connectionOk = 1;
      clientConnectionOk[uid] = 1;
    } else {
      clientConnectionOk[uid] = 0;
    }
  } catch (err) {
    console.error(uid + ', client connection not active');
    connectionOk = 0;
    clientConnectionOk[uid] = 0;
  }
  return connectionOk;
}

if (isTarget('api')) {
  const express = require('express');
  const cors = require('cors');

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(utils.jwtCheck);
  app.use(function (req, res, next) {
    const {
      sub: uid
    } = req.user;
    uidlog(uid, 'Function called: ' + req.originalUrl);
    next();
  });

  app.post('/smarthome', async (req, res) => {
    const {
      sub: uid
    } = req.user;
    checkClientConnection(uid);
    uidlog(uid, 'received ' + JSON.stringify(req.body));
    const reqId = req.body.requestId;

    //TODO cache client version from database
    //TODO check client version support and send UPDATE_CLIENT message if on version mismatch

    //handler SYNC, EXECUTE, QUERY
    if (!req.body || !Array.isArray(req.body.inputs) || !req.body.inputs[0]) {
      res.status(400).send({ error: 'invalid request' });
      return;
    }
    var intent = req.body.inputs[0].intent;
    var input = req.body.inputs[0];
    if (intent == 'action.devices.SYNC') {
      //SYNC
      const sync = require('./handleSYNC');
      await sync.handleSYNC(uid, reqId, res);
    } else if (intent == 'action.devices.QUERY') {
      //QUERY
      if (!(uid in clientConnectionOk) || clientConnectionOk[uid]) {
        const query = require('./handleQUERY');
        await query.handleQUERY(uid, reqId, res, input);
      } else {
        //report client not connected
        const error = require('./handleERROR');
        await error.handleERROR(uid, reqId, res, input, {
          clientnotconnected: 1
        });
      }
    } else if (intent == 'action.devices.EXECUTE') {
      //EXECUTE
      if (!(uid in clientConnectionOk) || clientConnectionOk[uid]) {
        const execute = require('./handleEXECUTE');
        await execute.handleEXECUTE(uid, reqId, res, input);
      } else {
        //report client not connected
        const error = require('./handleERROR');
        await error.handleERROR(uid, reqId, res, input, {
          clientnotconnected: 1
        });
      }
    } else if (intent == 'action.devices.DISCONNECT') {
      //DISCONNECT
      const disconnect = require('./handleDISCONNECT');
      await disconnect.handleDISCONNECT(uid, reqId, res);
    } else {
      res.status(400).send({ error: 'unsupported intent' });
    }
  });

  require('./clientapi').registerClientApi(app);

  const api = functions.region('europe-west1').https.onRequest(app);

  exports["api"] = api;
} //api/smarthome

if (isTarget('reportstate')) {
  exports["reportstate"] = require('./reportstate').reportstate;
}

if (isTarget('dynamicfunctionsv1')) {
  exports["dynamicfunctionsv1"] = require('./clientfunctions').clientfunctions;
}

if (isTarget('codelanding')) {
  exports["codelanding"] = require('./codelanding').codelanding;
} //codelanding/start

if (isTarget('firebase')) {
  exports["firebase"] = require('./firebase_token').firebase;
} //firebase/token

if (isTarget('admin')) {
  exports["admin"] = require('./admin').admin;
} //admin/