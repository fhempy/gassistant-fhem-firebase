const admin = require("firebase-admin");
const functions = require("firebase-functions");
const jwt = require('express-jwt');
const jwks = require('jwks-rsa');
const jsonwt = require('jsonwebtoken');
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const settings = require('./settings.json');

var allDevices = {};
//var allInformIds = {};
var googleToken = '';

admin.initializeApp(functions.config().firebase);
const fssettings = {timestampsInSnapshots: true};
admin.firestore().settings(fssettings);

const realdb = admin.database();
const firestoredb = admin.firestore();


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

//BACKWARD COMPATIBILITY
async function getLastSyncTimestamp(uid) {
  var lastSync = await realdb.ref('/users/' + uid + '/lastSYNC').once('value');
  if (lastSync.val() && lastSync.val().value && lastSync.val().value.timestamp) {
    return lastSync.val().value.timestamp;
  }
  return 0;
}

async function loadDevice(uid, devicename) {
  var dev = 0;
  var ref = await realdb.ref('/users/' + uid + '/devices/' + devicename.replace(/\.|\#|\[|\]|\$/g, '_') + '/').once('value');
  ref.forEach(function(child) {
    uidlog(uid, 'loadDevice ' + devicename + ' ' + child.key);
    if (child.key === 'XXXDEVICEDEFXXX') {
      dev = child.val();

      if (!dev || !dev.mappings) {
        throw new Error('No mappings defined for ' + devicename);
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
  });
  
  if (dev)
    return dev;

  //BACKWARD COMPATIBILITY
  uidlog(uid, "OLDFUNCTION loadDevice");
  //TODO cache also just one device
  var lastSync = await getLastSyncTimestamp(uid);
  // if (allDevices[uid] === undefined || allDevices[uid]['.lastSYNC'] === undefined || allDevices[uid]['.lastSYNC'] < lastSync) {
  //   const NO_CACHE = 1;
  //   await loadDevices(uid, NO_CACHE);
  //   allDevices[uid]['.lastSYNC'] = lastSync;
  // }

  if (allDevices[uid] && allDevices[uid][devicename] && allDevices[uid][devicename].timestamp >= lastSync) {
    uidlog(uid, 'CACHE READ: loadDevice, devices/attributes/' + devicename);
    return allDevices[uid][devicename].device;
  }
  if (!allDevices[uid]) {
    allDevices[uid] = {};
  }

  uidlog(uid, 'FIRESTORE READ: loadDevice, devices/attributes/' + devicename);

  var docRef = await firestoredb.collection(uid).doc('devices').collection('attributes').doc(devicename).get();
  var device = docRef.data();
  if (!device || !device.mappings) {
    throw new Error('No mappings defined for ' + devicename);
  }
  for (characteristic_type in device.mappings) {
    let mappingChar = device.mappings[characteristic_type];
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
  allDevices[uid][devicename] = {'device': device, 'timestamp': lastSync};
  return device;
}

async function loadDevices(uid, nocache) {
  var devices = {};
  var found = 0;

  var d = await realdb.ref('/users/' + uid + '/devices').once('value');
  d.forEach(function(child) {
    child.forEach(function(r) {
      if (r.key === 'XXXDEVICEDEFXXX') {
        devices[child.key] = r.val();
        found = 1;
      }
    });
  });
  

  //BACKWARD COMPATIBILITY
  if (found === 0) {
    var lastSync = await getLastSyncTimestamp(uid);
    uidlog(uid, "OLDFUNCTION loadDevices");
    allDevices[uid] = {};
  
    var attributesRef = await firestoredb.collection(uid).doc('devices').collection('attributes');
    var attrRef = await attributesRef.get();
    for (attr of attrRef.docs) {
      var d = attr.data();
      uidlog(uid, 'FIRESTORE READ: loadDevices, devices/attributes/' + d.name);
      for (characteristic_type in d.mappings) {
        let mappingChar = d.mappings[characteristic_type];
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
      devices[d.name] = d;
      allDevices[uid][d.name] = {'device': d, 'timestamp': lastSync};
    }
  }
  
  return devices;
}

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

async function setReadingValue(uid, device, reading, val, options) {
  if (!val)
    val = '';

  var format = '';
  if (reading.match(/temp|humidity/))
    format = 'float0.5';

  reading = reading.replace(/\.|\#|\[|\]|\$/g, '_');
  await realdb.ref('/users/' + uid + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading).set({value: val, 'format': format});
  
  //BACKWARD COMPATIBILITY
  await realdb.ref('/users/' + uid + '/informids/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '-' + reading).set({value: val, device: device});

  uidlog(uid, 'Reading updated ' + device + ':' + reading + ' = ' + val);
}

async function getDeviceAndReadings(uid, device) {
  var readings = {};
  var dev = 0;
  var clientstate = await realdb.ref('/users/' + uid + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_')).once('value');
  clientstate.forEach(function(child) {
    if (child.key === 'XXXDEVICEDEFXXX') {
      dev = child.val();
      
      if (!dev || !dev.mappings) {
        throw new Error('No mappings defined for ' + device);
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
    } else {
      readings[child.key] = child.val().value;
    }
  });
  
  //BACKWARD COMPATIBILITY new version not synced yet
  clientstate = await realdb.ref('/users/' + uid + '/informids').once('value');
  clientstate.forEach(function(child) {
    //remove trailing device name (device-reading)
    if (child.key.startsWith(device.replace(/\.|\#|\[|\]|\$/g, '_') + '-')) {
      var reading = child.key.replace(device.replace(/\.|\#|\[|\]|\$/g, '_') + '-', '');
      if (!readings[reading]) {
        uidlog(uid, 'OLDFUNCTION getinformids - SYNC needed');
        readings[reading] = child.val().value;
      }
    }
  });
  
  if (dev === 0) {
    uidlog(uid, 'OLDFUNCTION getinformids - loadDevice - SYNC needed');
    dev = await loadDevice(uid, device);
  }

  return {device: dev, readings: readings};
}

async function getReadingValue(uid, device, reading) {
  var clientstate = await realdb.ref('/users/' + uid + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading.replace(/\.|\#|\[|\]|\$/g, '_')).once('value');
  if (clientstate.val() && clientstate.val().value) {
    uidlog(uid, 'Reading read from db: ' + device + ':' + reading + ' = ' + clientstate.val().value);
    return clientstate.val().value;
  } else {
    //BACKWARD COMPATIBILITY get informid from old values
    clientstate = await realdb.ref('/users/' + uid + '/informids/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '-' + reading.replace(/\.|\#|\[|\]|\$/g, '_')).once('value');
    if (clientstate.val() && clientstate.val().value) {
      uidlog(uid, 'OLDFUNCTION from db: ' + informId + ' = ' + clientstate.val().value);
      return clientstate.val().value;
    }
  }

  return undefined;
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


async function reportState(uid, device, reading) {
  const hquery = require('./handleQUERY');
  
  //FIXME device parameter missing, informid doesn't include device name
  const reportstate = 1;
  var deviceQueryRes = await hquery.processQUERY(uid, {
      intent: 'action.devices.QUERY',
      payload: {
        devices: [{
          id: device,
          customData: {
            device: device
          }
        }]
      }
  }, reportstate);

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
    const reportStateRes = await fetch('https://homegraph.googleapis.com/v1/devices:reportStateAndNotification', options);
    uidlog(uid, 'reportstateres: ' + await reportStateRes.status);
    
    if (reportStateRes.status == 401) {
      google_token = await retrieveGoogleToken(uid);
    } else if (reportStateRes.status == 404) {
      break;
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
  setReadingValue,
  getReadingValue,
  getSyncFeatureLevel,
  getRealDB,
  getFirestoreDB,
  getDeviceAndReadings
};
