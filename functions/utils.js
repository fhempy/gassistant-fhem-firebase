const admin = require("firebase-admin");
const functions = require("firebase-functions");
const jwt = require('express-jwt');
const jwks = require('jwks-rsa');
const jsonwt = require('jsonwebtoken');
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const settings = require('./settings.json');

var allDevicesCache = {};
//var allInformIds = {};
var googleToken = '';

admin.initializeApp(functions.config().firebase);
const fssettings = {timestampsInSnapshots: true};
admin.firestore().settings(fssettings);

const realdb = admin.database();
const firestoredb = admin.firestore();

var ratePerUser = {};

function rateLimiter(rate, seconds) {
  return function(req, res, next) {
    const {sub: uid} = req.user;
    if (!ratePerUser[uid]) {
      ratePerUser[uid] = {
        counter: 1,
        time: Date.now()
      };
    } else {
      ratePerUser[uid].counter++;
    }
    
    if (ratePerUser[uid].counter > rate) {
      if ((ratePerUser[uid].time+seconds*1000) > Date.now()) {
        //within 5 minutes
        uiderror(uid, 'Rate limit reached - too many requests');
        res.status(429).send('Too many requests');
        return undefined;
      } else {
        //above 5 minutes, reset counter
        ratePerUser[uid].counter = 0;
        ratePerUser[uid].time = Date.now();
      }
    }
    next();
  }
}

function getRealDB() {
  return realdb;
}

function getFirestoreDB() {
  return firestoredb;
}

const jwtCheck = jwt({
	secret: jwks.expressJwtSecret({
          cache: true,
	  rateLimit: true,
	  jwksRequestsPerMinute: 5,
	  jwksUri: settings.AUTH0_DOMAIN + '/.well-known/jwks.json',
	}),
	audience: settings.AUDIENCE_URI,
	issuer: settings.AUTH0_DOMAIN + '/',
	algorithms: ['RS256']
});

function createDirective(reqId, payload) {
    return {
        requestId: reqId,
        payload: payload
    };
}// createDirective

async function getGoogleToken() {
  if (googleToken != '')
    return googleToken;

  var googleTokenRef = await firestoredb.collection('settings').doc('googletoken').get();

  if (googleTokenRef.data() && googleTokenRef.data().token)
    return googleTokenRef.data().token;

  return undefined;
}

function setGoogleToken(google_token) {
  googleToken = google_token;
  firestoredb.collection('settings').doc('googletoken').set({token: google_token})
    .then(r => {});
}

async function getSyncFeatureLevel(uid) {
  var state = await firestoredb.collection(uid).doc('state').get();

  if (state.data() && state.data().featurelevel)
    return state.data().featurelevel;

  return 0;
}

// async function setReadingValue(uid, device, reading, val, options) {
//   if (!val)
//     val = '';

//   var format = '';
//   if (reading.match(/temp|humidity/))
//     format = 'float0.5';

//   reading = reading.replace(/\.|\#|\[|\]|\$/g, '_');
//   await realdb.ref('/users/' + uid + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading).set({value: val, 'format': format});

//   uidlog(uid, 'Reading updated ' + device + ':' + reading + ' = ' + val);
// }

function prepareDevice(uid, dev) {
  if (!dev || !dev.mappings) {
    throw new Error('No mappings identified for ' + dev.name);
  }
  for (characteristic_type in dev.mappings) {
    let mappingChar = dev.mappings[characteristic_type];
    //mappingChar = Modes array

    if (!Array.isArray(mappingChar))
      mappingChar = [mappingChar];

    let mappingRoot;
    for (mappingRoot in mappingChar) {
      mappingRoot = mappingChar[mappingRoot];
      //mappingRoot = first element of Modes array
      if (!Array.isArray(mappingRoot))
	      mappingRoot = [mappingRoot];

      for (mappingElement in mappingRoot) {
  			mapping = mappingRoot[mappingElement];
  			
        if (mapping.reading2homekit) {
          eval('mapping.reading2homekit = ' + mapping.reading2homekit);
        }
        if (mapping.homekit2reading) {
          eval('mapping.homekit2reading = ' + mapping.homekit2reading);
        }
      }
    }
  }
}

async function getLastSyncTimestamp(uid) {
  var lastSyncRef = await realdb.ref('/users/' + uid + '/lastSync').once('value');
  uidlog(uid, 'getLastSyncTimestamp');
  if (lastSyncRef.val() && lastSyncRef.val().ts)
    return lastSyncRef.val().ts;

  return 0
}

async function loadDevice(uid, devicename) {
  if (!allDevicesCache[uid]) {
    allDevicesCache[uid] = {
      timestamp: -1,
      devices: {
      }
    };
    allDevicesCache[uid]['devices'][devicename] = {
      'device': {},
      'readings': {},
      'timestamp': -1
    };
  }
  
  var updateDevFromDb = 0;
  var lastSyncTs = await getLastSyncTimestamp(uid);
  if (allDevicesCache[uid]['devices'][devicename]) {
    if (lastSyncTs > allDevicesCache[uid]['devices'].timestamp) {
      updateDevFromDb = 1;
    }
    if (lastSyncTs > allDevicesCache[uid]['devices'][devicename].timestamp) {
      updateDevFromDb = 1;
    }
  } else {
    updateDevFromDb = 1;
  }
  
  if (updateDevFromDb) {
    var ref = await realdb.ref('/users/' + uid + '/devices/' + devicename.replace(/\.|\#|\[|\]|\$/g, '_') + '/').once('value');
    ref.forEach(function(child) {
      if (child.key === 'XXXDEVICEDEFXXX') {
        allDevicesCache[uid]['devices'][devicename] = {
          'device': child.val(),
          'timestamp': lastSyncTs,
          'readings': {}
        };
        prepareDevice(uid, allDevicesCache[uid]['devices'][devicename]['device']);
      }
    });
  } else {
    uidlog(uid, 'CACHED READ ' + devicename);
  }

  return allDevicesCache[uid]['devices'][devicename]['device'];
}

async function loadDevices(uid, nocache) {
  var devices = {};
  
  if (!allDevicesCache[uid] || nocache) {
    allDevicesCache[uid] = {
      timestamp: -1,
      devices: {}
    };
  }
  
  var lastSyncTs = await getLastSyncTimestamp(uid);
  var updateDevFromDb = 0;
  if (lastSyncTs > allDevicesCache[uid].timestamp) {
    updateDevFromDb = 1;
  }
  if (nocache)
    updateDevFromDb = 1;

  if (updateDevFromDb) {
    var allDevices = await realdb.ref('/users/' + uid + '/devices').once('value');
    allDevices.forEach(function(device) {
      device.forEach(function(child) {
        if (child.key === 'XXXDEVICEDEFXXX') {
          allDevicesCache[uid]['devices'][child.val().name] = {
            'device': child.val(),
            'timestamp': lastSyncTs,
            'readings': {}
          };
          prepareDevice(uid, allDevicesCache[uid]['devices'][child.val().name]['device']);
          devices[child.val().name] = allDevicesCache[uid]['devices'][child.val().name]['device'];
        }
      });
    });
    allDevicesCache[uid].timestamp = lastSyncTs;
  } else {
    for(var d in allDevicesCache[uid]['devices']) {
      var dd = allDevicesCache[uid]['devices'][d];
      devices[d] = dd.device;
    }
    uidlog(uid, 'CACHED READ ALL');
  }
  return devices;
}

async function getAllDevicesAndReadings(uid) {
  var readings = {};
  var tmpReadings = {};
  var devices = {};
  var tmpDev;
  var found = 0;
  
  await loadDevices(uid);
  
  var allReadings = await realdb.ref('/users/' + uid + '/readings').once('value');
  allReadings.forEach(function(device) {
    tmpReadings = {};
    
    device.forEach(function(child) {
      allDevicesCache[uid]['devices'][child.val().devname]['readings'][child.key] = child.val().value;
    });
  });

  return allDevicesCache[uid]['devices'];
}

async function getDeviceAndReadings(uid, devname) {
  var readings = {};
  
  await loadDevice(uid, devname);
  
  var readings = await realdb.ref('/users/' + uid + '/readings/' + devname.replace(/\.|\#|\[|\]|\$/g, '_')).once('value');
  readings.forEach(function(child) {
    readings[child.key] = child.val().value;
  });

  return {device: allDevicesCache[uid]['devices'][devname]['device'], readings: readings};
}

async function getClientVersion(uid) {
  var docRef = await firestoredb.collection(uid).doc('client').get();
  var client = docRef.data();
  var usedVersion = "0.0.1";
  if (client.packageversion)
    usedVersion = client.packageversion;
  return usedVersion;
}

async function retrieveGoogleToken(uid) {
  var token = jsonwt.sign({
    "iss": settings.SERVICEACCOUNT,
    "scope": "https://www.googleapis.com/auth/homegraph",
    "aud": "https://accounts.google.com/o/oauth2/token"
  },
  settings.PRIVATE_KEY,
  {
    algorithm: 'RS256',
    expiresIn: 60*60
  });
  
  //sign JWT https://github.com/auth0/node-jsonwebtoken
  //request access token from https://accounts.google.com/o/oauth2/token
  //send POST to request a token
  const { URLSearchParams } = require('url');
  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.append('assertion', token);

  const fetch = require('node-fetch');
  var options = { method: 'POST',
    body: params
    };
  const response = await fetch('https://accounts.google.com/o/oauth2/token', options);
  var resJson = await response.json();
  
  uidlog(uid, 'access_token from Google: ' + await JSON.stringify(resJson));
  
  //access token from google
  return await resJson.access_token;
}


async function reportState(uid, device) {
  const hquery = require('./handleQUERY');
  var query = {
    intent: 'action.devices.QUERY',
    payload: {
      devices: []
    }
  };

  if(!device) {
    //report all devices
    var devices = await loadDevices(uid);
    for (var de in devices) {
      const d = devices[de];
      query.payload.devices.push({
        id: d.uuid_base,
        customData: {
          device: d.uuid_base
        }
      });
    }
  } else {
    query.payload.devices.push({
      id: device,
      customData: {
        device: device
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

  //TODO check if token is already older than one hour and renew it if so
  var google_token = await getGoogleToken();
  if (!google_token)
    google_token = await retrieveGoogleToken(uid);
  
  //report state
  const fetch = require('node-fetch');
  for (var i=0; i<2; i++) {
    var options = { method: 'POST',
      headers: {
        Authorization: 'Bearer ' + google_token,
        'X-GFE-SSL': 'yes',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dev)
    };
    uidlog(uid, 'reportState fetch');
    const reportStateRes = await fetch('https://homegraph.googleapis.com/v1/devices:reportStateAndNotification', options);
    uidlog(uid, 'reportState response: ' + await reportStateRes.status);
    
    if (reportStateRes.status == 401) {
      google_token = await retrieveGoogleToken(uid);
    } else {
      //save the token to database
      setGoogleToken(google_token);
      break;
    }
  }
}

module.exports = {
  createDirective,
  jwtCheck,
  reportState,
  loadDevice,
  loadDevices,
  retrieveGoogleToken,
  getGoogleToken,
  setGoogleToken,
  getSyncFeatureLevel,
  getRealDB,
  getFirestoreDB,
  getAllDevicesAndReadings,
  getDeviceAndReadings,
  rateLimiter,
  getClientVersion
};
