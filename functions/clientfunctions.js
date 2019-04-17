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
    return CLOUD_FUNCTIONS_BASE.replace('europe-west1','us-central1') + "/reportstate/alldevices";
  }
  
  function getReportStateURL() {
    return CLOUD_FUNCTIONS_BASE.replace('europe-west1','us-central1') + "/reportstate/singledevice";
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
    var server = await database.getServerFeatureLevel();
    var sync = await database.getSyncFeatureLevel();
    log.info('SERVER FeatureLevel:' + JSON.stringify(server));
    log.info('SYNC   FeatureLevel:' + JSON.stringify(sync));

    if (server.featurelevel > sync.featurelevel) {
      //set changelog
      log.info('>>> VERSION UPGRADE STARTED');
      for (var fhem of this.connections) {
        await fhem.reload();
      }
      await database.initiateSync();
      log.info('>>> VERSION UPGRADE FINISHED - SYNC INITIATED');
    }

    global.syncFeatureLevel = sync.featurelevel;
    await require('./dynamicfunctions').checkFeatureLevelTimer(this);
  }

  async function checkFeatureLevelTimer(thisObj) {
    await require('./dynamicfunctions').FHEM_getClientFunctions();
    log.info('DynamicFunctions updated');

    //update every 1-4 days
    setTimeout(require('./dynamicfunctions').checkFeatureLevel.bind(thisObj), 86400000 + Math.floor(Math.random() * Math.floor(259200000)));
    //setTimeout(require('./dynamicfunctions').checkFeatureLevel.bind(thisObj), 5000 + Math.floor(Math.random() * Math.floor(20000)));
  }

  function registerFirestoreListener() {
    //TODO delete all docs in the collection to prevent using old data
    try {
      database.db.collection(database.getUid()).doc('msgs').collection('firestore2fhem').onSnapshot((events) => {
        events.forEach((event) => {
          log.info('GOOGLE MSG RECEIVED: ' + JSON.stringify(event.data()));
          if (event.data()) {
            handler.bind(this)(event.data());
          }
          event.ref.delete();
        });
      });
    } catch(err) {
      log.error('onSnapshot failed: ' + err);
    }
  }
  
  // entry
  async function handler(event, callback) {
      if (!event.msg) {
          //something was deleted in firestore, no need to handle
          return;
      }
      
      log.info("Received firestore2fhem: " + JSON.stringify(event));
  
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
                  log.info("#################################################");
                  log.info("#################################################");
                  log.info("#################################################");
                  log.info("#################################################");
                  log.info("!!!!!!!!PLEASE UPDATE YOUR CLIENT ASAP!!!!!!!!!!!");
                  log.info("#################################################");
                  log.info("#################################################");
                  log.info("#################################################");
                  log.info("#################################################");
                  break;
                  
              case 'STOP_CLIENT':
                  process.exit(1);
                  break;
  
              default:
                  log.info("Error: Unsupported event", event);
  
                  //TODO response = handleUnexpectedInfo(requestedNamespace);
  
                  break;
  
          }// switch
  
      } catch (error) {
  
          log.error(error);
  
      }// try-catch
  
      //return response;
  
  }// exports.handler
  
  
  async function updateDeviceReading(device, reading, val) {
    if (1 || require('./version').split('.')[0] < 2) {
      await database.realdb.ref('users/' + database.getUid() + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading.replace(/\.|\#|\[|\]|\$/g, '_')).set({value: val});
      await database.realdb.ref('users/' + database.getUid() + '/readings/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading.replace(/\.|\#|\[|\]|\$/g, '_')).set({value: val, devname: device});
    } else {
      if (typeof syncFeatureLevel === 'undefined' || syncFeatureLevel < 3) {
        //OLD
        await database.realdb.ref('users/' + database.getUid() + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading.replace(/\.|\#|\[|\]|\$/g, '_')).set({value: val});
      } else {
        await database.realdb.ref('users/' + database.getUid() + '/readings/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading.replace(/\.|\#|\[|\]|\$/g, '_')).set({value: val, devname: device});
      }
    }
  }

  async function
  FHEM_update(device, reading, readingSetting, orig, reportState) {
      if (orig === undefined)
          return;
  
      if (!FHEM_devReadingVal[device])
        FHEM_devReadingVal[device] = {};
      if (!FHEM_devReadingVal[device][reading])
        FHEM_devReadingVal[device][reading] = '';
  
      if (orig !== FHEM_devReadingVal[device][reading] || reportState === 0) {
        FHEM_devReadingVal[device][reading] = orig;
        await require('./dynamicfunctions').updateDeviceReading(device, reading, orig);
        log.info('update reading: ' + device + ':' + reading + ' = ' + orig);
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
    'global.log': 'require("./logger")._system;',
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
    'exports.checkFeatureLevelTimer': checkFeatureLevelTimer.toString(),
    'exports.registerFirestoreListener': registerFirestoreListener.toString(),
    'exports.updateDeviceReading': updateDeviceReading.toString(),
    'global.handler': handler.toString()
  });
});


const clientfunctions = functions.region('europe-west1').https.onRequest(app);

module.exports = {
  clientfunctions
};
