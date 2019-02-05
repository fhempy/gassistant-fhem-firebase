const functions = require("firebase-functions");
const admin = require("firebase-admin");
const utils = require('./utils');
const uidlog = require('./logger').uidlog;
const settings = require('./settings.json');

admin.initializeApp(functions.config().firebase);
const fssettings = {timestampsInSnapshots: true};
admin.firestore().settings(fssettings);

var clientConnectionOk = {};

async function checkClientConnection(uid) {
  var connectionOk = 0;
  try {
    var clientstate = await admin.database().ref('/users/' + uid + '/heartbeat').once('value');
    uidlog(uid, 'check client connection: ' + JSON.stringify(clientstate.val()));
    if (clientstate.val() && clientstate.val().active && (clientstate.val().time+9000) > Date.now()) {
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

if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'api') {
  const bodyParser = require('body-parser');
  const express = require('express');
  const cors = require('cors');

  const app = express();
  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({extended: true}));

  app.post('/smarthome', utils.jwtCheck, async (req, res) => {
    const {sub: uid} = req.user;
    checkClientConnection(uid);
    uidlog(uid, 'received ' + JSON.stringify(req.body));
    const reqId = req.body.requestId;

    //TODO cache client version from database
    //TODO check client version support and send UPDATE_CLIENT message if on version mismatch

    //handler SYNC, EXECUTE, QUERY
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
        error = require('./handleERROR');
        await error.handleERROR(uid, reqId, res, input, {clientnotconnected: 1});
      }
    } else if (intent == 'action.devices.EXECUTE') {
      //EXECUTE
      if (!(uid in clientConnectionOk) || clientConnectionOk[uid]) {
        const execute = require('./handleEXECUTE');
        await execute.handleEXECUTE(uid, reqId, res, input);
      } else {
        //report client not connected
        error = require('./handleERROR');
        await error.handleERROR(uid, reqId, res, input, {clientnotconnected: 1});
      }
    } else if (intent == 'action.devices.DISCONNECT') {
      //DISCONNECT
      const disconnect = require('./handleDISCONNECT');
      await disconnect.handleDISCONNECT(uid, reqId, res);
    }
  });
  
  require('./clientapi').registerClientApi(app);
  
  const api = functions.region('europe-west1').https.onRequest(app);
  
  exports["api"] = api;
} //api/smarthome

// if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'reportstateUpdate') {
//   exports.reportstateUpdate = require('./clientapi').reportstateUpdate;
// }

// if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'reportstateCreate') {
//   exports.reportstateCreate = require('./clientapi').reportstateCreate;
// }

if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'codelanding') {
  exports["codelanding"] = require('./codelanding').codelanding;
} //codelanding/start

if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'firebase') {
  exports["firebase"] = require('./firebase_token').firebase;
} //firebase/token

//reportstate - onUpdate
//exports.reportstate = require('./reportstate').reportstate;
