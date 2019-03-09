const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const utils = require('./utils');
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const settings = require('./settings.json');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(utils.jwtCheck);
app.use(function(req, res, next) {
  const {sub: uid} = req.user;
  uidlog(uid, 'Function called: ' + req.originalUrl);
  next();
});

app.get('/getdynamicfunctions', async (req, res) => {
  const {sub: uid} = req.user;
  
  function getInitSyncURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/initsync";
  }
  
  function getSyncFinishedURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/syncfinished";
  }
  
  function getReportStateAllURL() {
    return CLOUD_FUNCTIONS_BASE + "/reportstate/alldevices";
  }
  
  function getReportStateURL() {
    return CLOUD_FUNCTIONS_BASE + "/reportstate/singledevice";
  }
  
  function getDeleteUserAccountURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/deleteuseraccount";
  }
  
  function getServerFeatureLevelURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/getfeaturelevel";
  }
  
  function getSyncFeatureLevelURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/getsyncfeaturelevel";
  }
  
  function getConfigurationURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/getconfiguration";
  }
  
  async function checkFeatureLevel() {
    await database.getClientFunctions();
    console.log('DynamicFunctions updated');

    var server = await database.getServerFeatureLevel();
    var sync = await database.getSyncFeatureLevel();
    console.log('SERVER FeatureLevel:' + JSON.stringify(server));
    console.log('SYNC   FeatureLevel:' + JSON.stringify(sync));

    if (server.featurelevel > sync.featurelevel) {
      //set changelog
      console.log('>>> VERSION UPGRADE STARTED');
      for (var fhem of this.connections) {
        await fhem.reload();
      }
      await database.initiateSync();
      console.log('>>> VERSION UPGRADE FINISHED - SYNC INITIATED');
    }

    //update every 1-4 days
    setTimeout(checkFeatureLevel.bind(this), 86400000 + Math.floor(Math.random() * Math.floor(259200000)));
  }
  
  function registerFirestoreListener() {
    //TODO delete all docs in the collection to prevent using old data
    try {
      database.db.collection(database.getUid()).doc('msgs').collection('firestore2fhem').onSnapshot((events) => {
        events.forEach((event) => {
          console.log('GOOGLE MSG RECEIVED: ' + JSON.stringify(event.data()));
          if (event.data()) {
            handler.bind(this)(event.data());
          }
          event.ref.delete();
        });
      });
    } catch(err) {
      console.error('onSnapshot failed: ' + err);
    }
  }
  
  // entry
  async function handler(event, callback) {
      if (!event.msg) {
          //something was deleted in firestore, no need to handle
          return;
      }
      
      console.log("Received firestore2fhem: " + JSON.stringify(event));
  
      try {
  
          switch (event.msg) {
  
              case 'EXECUTE':
                  require('./fhem').FHEM_execute({base_url: event.connection}, event.cmd);
                  break;

              case 'REPORTSTATEALL':
                  setTimeout(require('./database').reportStateAll, parseInt(event.delay) * 1000);
                  break;

              case 'UPDATE_SYNCFEATURELEVEL':
                  for (var fhem of this.connections) {
                      fhem.execute('setreading ' + fhem.gassistant + ' gassistant-fhem-usedFeatureLevel ' + event.featurelevel);
                  }
                  break;
  
              case 'UPDATE_SERVERFEATURELEVEL':
                  for (var fhem of this.connections) {
                      fhem.execute('setreading ' + fhem.gassistant + ' gassistant-fhem-availableFeatureLevel ' + event.featurelevel);
                  }
                  break;
  
              case 'LOG_ERROR':
                  for (var fhem of this.connections) {
                      fhem.execute('setreading ' + fhem.gassistant + ' gassistant-fhem-lastServerError ' + event.log);
                  }
                  break;
  
              case 'UPDATE_CLIENT':
                  console.log("#################################################");
                  console.log("#################################################");
                  console.log("#################################################");
                  console.log("#################################################");
                  console.log("!!!!!!!!PLEASE UPDATE YOUR CLIENT ASAP!!!!!!!!!!!");
                  console.log("#################################################");
                  console.log("#################################################");
                  console.log("#################################################");
                  console.log("#################################################");
                  break;
                  
              case 'STOP_CLIENT':
                  process.exit(1);
                  break;
  
              default:
                  console.log("Error: Unsupported event", event);
  
                  //TODO response = handleUnexpectedInfo(requestedNamespace);
  
                  break;
  
          }// switch
  
      } catch (error) {
  
          console.error(error);
  
      }// try-catch
  
      //return response;
  
  }// exports.handler

  async function
  FHEM_update(device, reading, readingSetting, orig, reportState) {
      if (orig === undefined)
          return;
  
      if (!FHEM_devReadingVal[device])
        FHEM_devReadingVal[device] = {};
      if (!FHEM_devReadingVal[device][reading])
        FHEM_devReadingVal[device][reading] = '';
  
      if (orig !== FHEM_devReadingVal[device][reading]) {
        FHEM_devReadingVal[device][reading] = orig;
        await database.updateDeviceReading(device, reading, orig);
        console.log('update reading: ' + device + ':' + reading + ' = ' + orig);
      }

      if(!FHEM_reportStateStore[device])
        FHEM_reportStateStore[device] = {};

      if(!FHEM_reportStateStore[device][reading])
        FHEM_reportStateStore[device][reading] = {};

      if (reportState) {
        const oldDevStore = FHEM_reportStateStore[device];
        if (FHEM_deviceReadings[device][reading].compareFunction) {
          eval('FHEM_deviceReadings[device][reading].compareFunction = ' + FHEM_deviceReadings[device][reading].compareFunction);
          if (!FHEM_reportStateStore[device][reading].oldValue) {
            //first call for this reading
            FHEM_reportStateStore[device][reading].cancelOldTimeout = FHEM_deviceReadings[device][reading].compareFunction('', 0, orig, undefined, 0, undefined, database.reportState, device);
          } else {
            var store = FHEM_reportStateStore[device][reading];
            FHEM_reportStateStore[device][reading].cancelOldTimeout = FHEM_deviceReadings[device][reading].compareFunction(store.oldValue, store.oldTimestamp, orig, store.cancelOldTimeout, oldDevStore.oldTimestamp, oldDevStore.cancelOldTimeout, database.reportState, device);
          }

          if (FHEM_reportStateStore[device][reading].cancelOldTimeout) {
            FHEM_reportStateStore[device].cancelOldTimeout = FHEM_reportStateStore[device][reading].cancelOldTimeout;
            FHEM_reportStateStore[device].oldTimestamp = Date.now();
          }
        }
      }
  
      FHEM_reportStateStore[device][reading].oldValue = orig;
      FHEM_reportStateStore[device][reading].oldTimestamp = Date.now();
  
      //FIXME ReportState only when connected
  }
  
  res.send({
    'exports.FHEM_update': FHEM_update.toString(),
    'exports.getInitSyncURL': getInitSyncURL.toString(),
    'exports.getSyncFinishedURL': getSyncFinishedURL.toString(),
    'exports.getReportStateAllURL': getReportStateAllURL.toString(),
    'exports.getReportStateURL': getReportStateURL.toString(),
    'exports.getDeleteUserAccountURL': getDeleteUserAccountURL.toString(),
    'exports.getServerFeatureLevelURL': getServerFeatureLevelURL.toString(),
    'exports.getSyncFeatureLevelURL': getSyncFeatureLevelURL.toString(),
    'exports.getConfigurationURL': getConfigurationURL.toString(),
    'exports.checkFeatureLevel': checkFeatureLevel.toString(),
    'exports.registerFirestoreListener': registerFirestoreListener.toString(),
    'global.handler': handler.toString()
  });
});


const clientfunctions = functions.region('europe-west1').https.onRequest(app);

module.exports = {
  clientfunctions
};
