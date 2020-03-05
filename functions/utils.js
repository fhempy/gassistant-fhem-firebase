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
const fssettings = {
  timestampsInSnapshots: true
};
admin.firestore().settings(fssettings);

const realdb = admin.database();
const firestoredb = admin.firestore();

var ratePerUser = {};

const GOOGLE_DEVICE_TYPES = {
  'ac_unit': 'action.devices.types.AC_UNIT',
  'aircondition': 'action.devices.types.AC_UNIT', //backward compatibility
  'airfreshener': 'action.devices.types.AIRFRESHENER',
  'airpurifier': 'action.devices.types.AIRPURIFIER',
  'awning': 'action.devices.types.AWNING',
  'bathtub': 'action.devices.types.BATHTUB',
  'bed': 'action.devices.types.BED',
  'blender': 'action.devices.types.BLENDER',
  'blinds': 'action.devices.types.BLINDS',
  'boiler': 'action.devices.types.BOILER',
  'camera': 'action.devices.types.CAMERA',
  'charger': 'action.devices.types.CHARGER',
  'closet': 'action.devices.types.CLOSET',
  'coffee_maker': 'action.devices.types.COFFEE_MAKER',
  'coffeemaker': 'action.devices.types.COFFEE_MAKER', //backward compatibility
  'cooktop': 'action.devices.types.COOKTOP',
  'curtain': 'action.devices.types.CURTAIN',
  'dehumidifier': 'action.devices.types.DEHUMIDIFIER',
  'dehydrator': 'action.devices.types.DEHYDRATOR',
  'dishwasher': 'action.devices.types.DISHWASHER',
  'door': 'action.devices.types.DOOR',
  'drawer': 'action.devices.types.DRAWER',
  'dryer': 'action.devices.types.DRYER',
  'fan': 'action.devices.types.FAN',
  'faucet': 'action.devices.types.FAUCET',
  'fireplace': 'action.devices.types.FIREPLACE',
  'fryer': 'action.devices.types.FRYER',
  'garage': 'action.devices.types.GARAGE',
  'gate': 'action.devices.types.GATE',
  'grill': 'action.devices.types.GRILL',
  'heater': 'action.devices.types.HEATER',
  'hood': 'action.devices.types.HOOD',
  'humidifier': 'action.devices.types.HUMIDIFIER',
  'kettle': 'action.devices.types.KETTLE',
  'light': 'action.devices.types.LIGHT',
  'lock': 'action.devices.types.LOCK',
  'mop': 'action.devices.types.MOP',
  'mower': 'action.devices.types.MOWER',
  'microwave': 'action.devices.types.MICROWAVE',
  'multicooker': 'action.devices.types.MULTICOOKER',
  'outlet': 'action.devices.types.OUTLET',
  'oven': 'action.devices.types.OVEN',
  'pergola': 'action.devices.types.PERGOLA',
  'petfeeder': 'action.devices.types.PETFEEDER',
  'pressurecooker': 'action.devices.types.PRESSURECOOKER',
  'radiator': 'action.devices.types.RADIATOR',
  'refrigerator': 'action.devices.types.REFRIGERATOR',
  'scene': 'action.devices.types.SCENE',
  'securitysystem': 'action.devices.types.SECURITYSYSTEM',
  'shutter': 'action.devices.types.SHUTTER',
  'shower': 'action.devices.types.SHOWER',
  'sousvide': 'action.devices.types.SOUSVIDE',
  'sprinkler': 'action.devices.types.SPRINKLER',
  'standmixer': 'action.devices.types.STANDMIXER',
  'switch': 'action.devices.types.SWITCH',
  'thermostat': 'action.devices.types.THERMOSTAT',
  'vacuum': 'action.devices.types.VACUUM',
  'valve': 'action.devices.types.VALVE',
  'washer': 'action.devices.types.WASHER',
  'waterheater': 'action.devices.types.WATERHEATER',
  'window': 'action.devices.types.WINDOW',
  'yogurtmaker': 'action.devices.types.YOGURTMAKER'
};

function getGoogleDeviceTypes() {
  var gDevTypes = [];
  for (var t in GOOGLE_DEVICE_TYPES) {
    gDevTypes.push(t);
  }
  return gDevTypes;
}

function getGoogleDeviceTypesMappings() {
  return GOOGLE_DEVICE_TYPES;
}

function rateLimiter(rate, seconds) {
  return function (req, res, next) {
    const {
      sub: uid
    } = req.user;
    if (!ratePerUser[uid]) {
      ratePerUser[uid] = {
        counter: 1,
        time: Date.now()
      };
    } else {
      ratePerUser[uid].counter++;
    }

    if (ratePerUser[uid].counter > rate) {
      if ((ratePerUser[uid].time + seconds * 1000) > Date.now()) {
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

async function sendCmd2Fhem(uid, fcmds) {
  for (var c in fcmds) {
    await admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({
      msg: 'EXECUTE',
      id: 0,
      cmd: fcmds[c],
      connection: c,
      ts: Date.now()
    });
  }
}

function createDirective(reqId, payload) {
  return {
    requestId: reqId,
    payload: payload
  };
} // createDirective

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
  firestoredb.collection('settings').doc('googletoken').set({
      token: google_token
    })
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
      devices: {}
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
    ref.forEach(function (child) {
      if (child.key === 'XXXDEVICEDEFXXX') {
        allDevicesCache[uid]['devices'][devicename] = {
          'device': child.val(),
          'timestamp': lastSyncTs,
          'readings': {}
        };
        try {
          prepareDevice(uid, allDevicesCache[uid]['devices'][devicename]['device']);
        } catch (err) {
          uiderror(uid, "Error with device " + devicename + ": " + err);
        }
      }
    });
  } else {
    uidlog(uid, 'CACHED READ ' + devicename);
  }

  if (!allDevicesCache[uid] || !allDevicesCache[uid]['devices'] || !allDevicesCache[uid]['devices'][devicename] || !allDevicesCache[uid]['devices'][devicename]['device'])
    return {};

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
    allDevices.forEach(function (device) {
      device.forEach(function (child) {
        if (child.key === 'XXXDEVICEDEFXXX') {
          allDevicesCache[uid]['devices'][child.val().name] = {
            'device': child.val(),
            'timestamp': lastSyncTs,
            'readings': {}
          };
          try {
            prepareDevice(uid, allDevicesCache[uid]['devices'][child.val().name]['device']);
            devices[child.val().name] = allDevicesCache[uid]['devices'][child.val().name]['device'];
          } catch (err) {
            uiderror(uid, "Error with device " + child.val().name + ": " + err);
          }
        }
      });
    });
    allDevicesCache[uid].timestamp = lastSyncTs;
  } else {
    for (var d in allDevicesCache[uid]['devices']) {
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
  allReadings.forEach(function (device) {
    tmpReadings = {};

    device.forEach(function (child) {
      if (!allDevicesCache[uid]['devices'][child.val().devname])
        allDevicesCache[uid]['devices'][child.val().devname] = {
          'timestamp': -1,
          'device': {},
          'readings': {}
        };
      allDevicesCache[uid]['devices'][child.val().devname]['readings'][child.key] = child.val().value;
    });
  });

  return allDevicesCache[uid]['devices'];
}

async function getDeviceAndReadings(uid, devname) {
  var readings = {};

  var dev = await loadDevice(uid, devname);

  var readings = await realdb.ref('/users/' + uid + '/readings/' + devname.replace(/\.|\#|\[|\]|\$/g, '_')).once('value');
  readings.forEach(function (child) {
    readings[child.key] = child.val().value;
  });

  return {
    device: dev,
    readings: readings
  };
}

async function getClientVersion(uid) {
  var docRef = await firestoredb.collection(uid).doc('client').get();
  var client = docRef.data();
  var usedVersion = "0.0.1";
  if (client && client.packageversion)
    usedVersion = client.packageversion;
  return usedVersion;
}

async function retrieveGoogleToken(uid) {
  var token = jsonwt.sign({
      "iss": settings.SERVICEACCOUNT,
      "scope": "https://www.googleapis.com/auth/homegraph",
      "aud": "https://accounts.google.com/o/oauth2/token"
    },
    settings.PRIVATE_KEY, {
      algorithm: 'RS256',
      expiresIn: 60 * 60
    });

  //sign JWT https://github.com/auth0/node-jsonwebtoken
  //request access token from https://accounts.google.com/o/oauth2/token
  //send POST to request a token
  const {
    URLSearchParams
  } = require('url');
  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.append('assertion', token);

  const fetch = require('node-fetch');
  var options = {
    method: 'POST',
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

  if (!device) {
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
  for (var i = 0; i < 2; i++) {
    var options = {
      method: 'POST',
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

function FHEM_reading2homekit_(uid, mapping, readings) {
  var value = readings[mapping.reading[0].replace(/\.|\#|\[|\]|\$/g, '_')];
  if (value === undefined)
    return undefined;

  var reading = mapping.reading.toString();

  if (reading == 'temperature' ||
    reading == 'measured' ||
    reading == 'measured-temp' ||
    reading == 'desired-temp' ||
    reading == 'desired' ||
    reading == 'desiredTemperature') {
    if (value == 'on')
      value = 31.0;
    else if (value == 'off')
      value = 4.0;
    else {
      value = parseFloat(value);
    }

    if (mapping.minValue !== undefined && value < mapping.minValue)
      value = mapping.minValue;
    else if (mapping.maxValue !== undefined && value > mapping.maxValue)
      value = mapping.maxValue;

    if (mapping.minStep) {
      if (mapping.minValue)
        value -= mapping.minValue;
      value = parseFloat((Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1));
      if (mapping.minValue)
        value += mapping.minValue;
    }

  } else if (reading == 'humidity') {
    value = parseInt(value);

  } else if (reading == 'onoff') {
    value = parseInt(value) ? true : false;

  } else if (reading === 'state' && (mapping.On &&
      typeof mapping.values !== 'object' &&
      mapping.reading2homekit === undefined &&
      mapping.valueOn === undefined && mapping.valueOff === undefined)) {
    if (value.match(/^set-/))
      return undefined;
    if (value.match(/^set_/))
      return undefined;

    if (mapping.event_map !== undefined) {
      var mapped = mapping.event_map[value];
      if (mapped !== undefined)
        value = mapped;
    }

    if (value == 'off')
      value = 0;
    else if (value == '000000')
      value = 0;
    else if (value.match(/^[A-D]0$/))
      value = 0;
    else
      value = 1;

  } else {
    if (value.match(/^set-/))
      return undefined;
    else if (value.match(/^set_/))
      return undefined;

    if (isNaN(value) === false) {
      value = parseFloat(value);
    }

    var orig = value;

    var format = undefined;
    if (typeof mapping.characteristic === 'object')
      format = mapping.characteristic.props.format;
    else if (typeof mapping.characteristic === 'function') {
      var characteristic = new(Function.prototype.bind.apply(mapping.characteristic, arguments));

      format = characteristic.props.format;

      //delete characteristic;
    } else if (mapping.format) { // only for testing !
      format = mapping.format;

    }

    if (mapping.event_map !== undefined) {
      var mapped = mapping.event_map[value];
      if (mapped !== undefined) {
        console.debug(mapping.reading.toString() + ' eventMap: value ' + value + ' mapped to: ' + mapped);
        value = mapped;
      }
    }

    if (value !== undefined && mapping.part !== undefined) {
      var mapped = value.split(' ')[mapping.part];

      if (mapped === undefined) {
        uiderror(uid, mapping.reading.toString() + ' value ' + value + ' has no part ' + mapping.part);
        return value;
      }
      console.debug(mapping.reading.toString() + ' parts: using part ' + mapping.part + ' of: ' + value + ' results in: ' + mapped);
      value = mapped;
    }

    if (mapping.threshold) {
      //if( !format.match( /bool/i ) && mapping.threshold ) {
      var mapped;
      if (parseFloat(value) > mapping.threshold)
        mapped = 1;
      else
        mapped = 0;
      console.debug(mapping.reading.toString() + ' threshold: value ' + value + ' mapped to ' + mapped);
      value = mapped;
    }

    if (mapping.valueError) {
      if (value.toString().match(mapping.valueError)) {
        return "ERROR";
      }
    }

    if (mapping.valueException) {
      if (value.toString().match(mapping.valueException)) {
        return "EXCEPTION";
      }
    }

    if (typeof mapping.value2homekit_re === 'object' || typeof mapping.value2homekit === 'object') {
      var mapped = undefined;
      if (typeof mapping.value2homekit_re === 'object')
        for (var entry of mapping.value2homekit_re) {
          if (entry.reading) {
            value = readings[entry.reading];
            if (!value)
              uiderror(uid, 'reading ' + entry.reading + ' not found in reading array: ' + JSON.stringify(readings));
          }
          if (value.toString().match(entry.re)) {
            mapped = entry.to;
            break;
          }
        }

      if (mapped === '#')
        mapped = value;

      if (typeof mapping.value2homekit === 'object')
        if (mapping.value2homekit[value] !== undefined)
          mapped = mapping.value2homekit[value];

      if (mapped === undefined)
        mapped = mapping.default;

      if (mapped === undefined) {
        uiderror(uid, mapping.reading.toString() + ' value ' + value + ' not handled in values');
        return undefined;
      }

      if (mapped == 'true' || mapped == 'false') {
        mapped = (mapped == 'true');
      }

      console.debug(mapping.reading.toString() + ' values: value ' + value + ' mapped to ' + mapped);
      value = mapped;
    }

    if (!format) {
      uidlog(uid, mapping.reading.toString() + ' empty format, value: ' + value);
    } else if (format.match(/bool/i)) {
      var mapped = undefined;;
      if (mapping.valueOn !== undefined) {
        var match = mapping.valueOn.match('^/(.*)/$');
        if (!match && value == mapping.valueOn)
          mapped = 1;
        else if (match && value.toString().match(match[1]))
          mapped = 1;
        else
          mapped = 0;
      }
      if (mapping.valueOff !== undefined) {
        var match = mapping.valueOff.match('^/(.*)/$');
        if (!match && value == mapping.valueOff)
          mapped = 0;
        else if (match && value.toString().match(match[1]))
          mapped = 0;
        else if (mapped === undefined)
          mapped = 1;
      }
      if (mapping.valueOn === undefined && mapping.valueOff === undefined) {
        if (value == 'on')
          mapped = 1;
        else if (value == 'off')
          mapped = 0;
        else
          mapped = parseInt(value) ? 1 : 0;
      }
      if (mapped !== undefined) {
        console.debug(mapping.reading.toString() + ' valueOn/valueOff: value ' + value + ' mapped to ' + mapped);
        value = mapped;
      }

      if (mapping.factor) {
        console.debug(mapping.reading.toString() + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

      if (mapping.invert) {
        mapping.minValue = 0;
        mapping.maxValue = 1;
      }

    } else if (format.match(/float/i)) {
      var mapped = parseFloat(value);

      if (typeof mapped !== 'number') {
        uiderror(uid, mapping.reading.toString() + ' is not a number: ' + value);
        return undefined;
      }
      value = mapped;

      if (mapping.factor) {
        console.debug(mapping.reading.toString() + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

    } else if (format.match(/int/i)) {
      var mapped = parseFloat(value);

      if (typeof mapped !== 'number') {
        uiderror(uid, mapping.reading.toString() + ' not a number: ' + value);
        return undefined;
      }
      value = mapped;

      if (mapping.factor) {
        console.debug(mapping.reading.toString() + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

      value = parseInt(value + 0.5);
    } else if (format.match(/string/i)) {}


    if (mapping.max && mapping.maxValue) {
      value = Math.round((value * mapping.maxValue / mapping.max) * 100) / 100;
      console.debug(mapping.reading.toString() + ' value ' + orig + ' scaled to: ' + value);
    }

    if (mapping.minValue !== undefined && value < mapping.minValue) {
      console.debug(mapping.reading.toString() + ' value ' + value + ' clipped to minValue: ' + mapping.minValue);
      value = mapping.minValue;
    } else if (mapping.maxValue !== undefined && value > mapping.maxValue) {
      console.debug(mapping.reading.toString() + ' value ' + value + ' clipped to maxValue: ' + mapping.maxValue);
      value = mapping.maxValue;
    }

    if (mapping.minStep) {
      if (mapping.minValue)
        value -= mapping.minValue;
      value = parseFloat((Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1));
      if (mapping.minValue)
        value += mapping.minValue;
    }

    if (format && format.match(/int/i))
      value = parseInt(value);
    else if (format && format.match(/float/i))
      value = parseFloat(value);

    if (typeof value === 'number') {
      var mapped = value;
      if (isNaN(value)) {
        uiderror(uid, mapping.reading.toString() + ' not a number: ' + orig);
        return undefined;
      } else if (mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined) {
        mapped = mapping.maxValue - value + mapping.minValue;
      } else if (mapping.invert && mapping.maxValue !== undefined) {
        mapped = mapping.maxValue - value;
      } else if (mapping.invert) {
        mapped = 100 - value;
      }

      if (value !== mapped)
        console.debug(mapping.reading.toString() + ' value: ' + value + ' inverted to ' + mapped);
      value = mapped;
    }
    if (format && format.match(/bool/i)) {
      value = parseInt(value) ? true : false;
    }
  }

  return value;
}

async function checkExceptions(uid, device, readings, response) {
  for (var exception_name in device.mappings.Exceptions) {
    //FIXME support exceptions for multiple responses
    if (device.mappings.Exceptions[exception_name].onlyLinkedInfo === false) {
      if (await cached2Format(uid, device.mappings.Exceptions[exception_name], readings) === "EXCEPTION") {
        response[0].states.exceptionCode = exception_name;
      }
    }
  }
}

async function checkLinkedDevices(uid, device) {
  var currentStatusReport = [];
  var isBlocking = false;
  if (device.mappings.LinkedDevices) {
    for (var ld of device.mappings.LinkedDevices.devices) {
      //devicename: ld.id
      //blocking: ld.blocking
      var linkedDevice = await getDeviceAndReadings(uid, ld.id);
      //check for exceptions in linkedDevice
      if (linkedDevice.device.mappings.Exceptions) {
        for (var exception_name in linkedDevice.device.mappings.Exceptions) {
          if (await cached2Format(uid, linkedDevice.device.mappings.Exceptions[exception_name], linkedDevice.readings) === "EXCEPTION") {
            if (ld.blocking)
              isBlocking = true;
            currentStatusReport.push({
              blocking: ld.blocking ? ld.blocking : false,
              deviceTarget: ld.id,
              priority: 0,
              statusCode: exception_name
            });
          }
        }
      }
    }
  }
  return {
    report: currentStatusReport,
    blocking: isBlocking
  };
}

function FHEM_reading2homekit(uid, mapping, readings) {
  var value = undefined;
  //BACKWARD COMPATIBILITY
  if (typeof mapping.reading === 'string') {
    uidlog(uid, 'OLDFUNCTION FHEM_reading2homekit - SYNC needed');
    mapping.reading = [mapping.reading];
  }
  var orig = readings[mapping.reading[0].replace(/\.|\#|\[|\]|\$/g, '_')];
  if (mapping.reading2homekit && typeof mapping.reading2homekit == 'function') {
    uidlog(uid, 'function found for reading2homekit');
    try {
      if (mapping.reading.length === 1) {
        orig = readings[mapping.reading[0].replace(/\.|\#|\[|\]|\$/g, '_')];
        value = mapping.reading2homekit(mapping, readings[mapping.reading[0].replace(/\.|\#|\[|\]|\$/g, '_')]);
      } else
        value = mapping.reading2homekit(mapping, readings);
    } catch (err) {
      uiderror(uid, mapping.reading[0] + ' reading2homekit: ' + err.stack, err);
      return undefined;
    }
    if (typeof value === 'number' && isNaN(value)) {
      uiderror(uid, mapping.reading[0] + ' not a number: ' + readings[mapping.reading[0].replace(/\.|\#|\[|\]|\$/g, '_')] + ' => ' + value);
      return undefined;
    }

  } else {
    value = FHEM_reading2homekit_(uid, mapping, readings);
  }

  if (value === undefined) {
    if (mapping.default !== undefined) {
      orig = 'mapping.default';
      value = mapping.default;
    } else
      return undefined;

  }

  var defined = undefined;
  if (mapping.homekit2name !== undefined) {
    defined = mapping.homekit2name[value];
    if (defined === undefined)
      defined = '???';
  }

  uidlog(uid, '    caching: ' + (mapping.name ? 'Custom ' + mapping.name : mapping.characteristic_type) + (mapping.subtype ? ':' + mapping.subtype : '') + ': ' +
    value + ' (' + 'as ' + typeof (value) + (defined ? '; means ' + defined : '') + '; from \'' + orig + '\')');
  mapping.cached = value;

  return value;
}

async function cached2Format(uid, mapping, readings) {
  return FHEM_reading2homekit(uid, mapping, readings);
}

module.exports = {
  cached2Format,
  checkExceptions,
  checkLinkedDevices,
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
  getClientVersion,
  getGoogleDeviceTypes,
  getGoogleDeviceTypesMappings,
  sendCmd2Fhem
};