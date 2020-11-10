const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const merge = require('deepmerge')
const utils = require('./utils');
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const uidlog = require('./logger').uidlog;
const uidlogfct = require('./logger').uidlogfct;
const uiderror = require('./logger').uiderror;
const hquery = require('./handleQUERY');
const util = require('util');
const settings = require('./settings.json');

var deviceRooms = {};

async function generateAttributes(uid, attr) {
  //generate traits
  var usedDeviceReadings = {};
  var devicesJSON = attr.devicesJSON;
  if (devicesJSON) {
    for (var d in devicesJSON) {
      try {
        uidlog(uid, 'start generateTraits for ' + devicesJSON[d].json.Internals.NAME);
        var dbDev = devicesJSON[d].json.Internals.NAME.replace(/\.|\#|\[|\]|\$/g, '_');
        var resTraits = await generateTraits(uid, devicesJSON[d], usedDeviceReadings);
        if (resTraits) {
          if (resTraits.device)
            attr.realDBUpdateJSON[dbDev] = merge(attr.realDBUpdateJSON[dbDev], resTraits.device);
          if (resTraits.virtualdevices)
            attr.realDBUpdateJSON = merge(attr.realDBUpdateJSON, resTraits.virtualdevices);
          uidlog(uid, 'finished generateTraits for ' + devicesJSON[d].json.Internals.NAME);
        } else {
          uidlog(uid, 'no mappings for device ' + devicesJSON[d].json.Internals.NAME);
        }
      } catch (err) {
        //uiderror(uid, err);
        uiderror(uid, 'failed to generateTraits for ' + devicesJSON[d].json.Internals.NAME + ', ' + err, err);
      }
    }
  } else {
    var devicesRef = await admin.firestore().collection(uid).doc('devices').collection('devices').get();
    for (device of devicesRef.docs) {
      try {
        uidlog(uid, 'start generateTraits for ' + device.data().json.Internals.NAME);
        var dbDev = device.data().json.Internals.NAME.replace(/\.|\#|\[|\]|\$/g, '_');
        var resTraits = await generateTraits(uid, device.data(), usedDeviceReadings);
        if (resTraits) {
          attr.realDBUpdateJSON[dbDev] = resTraits.device;
          uidlog(uid, 'finished generateTraits for ' + device.data().json.Internals.NAME);
        } else {
          uidlog(uid, 'no mappings for device ' + device.data().json.Internals.NAME);
        }
      } catch (err) {
        //uiderror(uid, err);
        uiderror(uid, 'failed to generateTraits for ' + device.data().json.Internals.NAME + ', ' + err, err);
      }
    }
  }
  return usedDeviceReadings;
}

async function generateTraits(uid, device, usedDeviceReadings) {
  var s = device.json;
  var connection = device.connection;
  //uidlog(uid, 'generateTraits: ' + JSON.stringify(s));
  if (!s.Readings) {
    uiderror(uid, 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without readings');
    return undefined;
  }
  if (!s.Attributes) {
    uiderror(uid, 'ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without attributes');
    return undefined;
  }

  if (s.Attributes.disable == 1) {
    uidlog(uid, s.Internals.NAME + ' is currently disabled');
  }

  var genericType = s.Attributes.genericDeviceType;
  if (!genericType === undefined)
    genericType = s.Attributes.genericDisplayType;

  if (genericType === 'ignore') {
    uidlog(uid, 'ignoring ' + s.Internals.NAME + ', genericDeviceType = ignore used');
    return undefined;
  }

  if (s.Internals.TYPE === 'structure' && genericType === undefined) {
    uidlog(uid, 'ignoring structure ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
    return undefined;
  }
  if (s.Internals.TYPE === 'SVG' && genericType === undefined) {
    uidlog(uid, 'ignoring SVG ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
    return undefined;
  }
  if (s.Internals.TYPE === 'THRESHOLD' && genericType === undefined) {
    uidlog(uid, 'ignoring THRESHOLD ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
    return undefined;
  }
  if (s.Internals.TYPE === 'notify' && genericType === undefined) {
    uidlog(uid, 'ignoring notify ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
    return undefined;
  }

  if (s.Internals.TYPE === 'FHEMSYNC_DEVICE') {
    s.Internals.TYPE = s.Internals.REMOTETYPE;
  }

  //CREATE MAPPINGS
  if (genericType === 'blind')
    genericType = 'blinds';
  else if (genericType === 'thermometer')
    genericType = 'thermostat';
  else if (genericType === 'contact')
    genericType = 'door';

  var service_name = genericType;
  var mappings = {};
  mappings.Exceptions = {};
  mappings.Errors = {};
  var max;
  var match;
  if (match = s.PossibleSets.match(/(^| )dim:slider,0,1,99/)) {
    // ZWave dimmer
    mappings.On = {
      reading: 'state',
      valueOff: '/^(dim )?0$/',
      cmdOn: 'on',
      cmdOff: 'off'
    };
    mappings.Brightness = {
      reading: 'state',
      cmd: 'dim'
    };

    mappings.Brightness.reading2homekit = function (mapping, orig) {
      var match;
      if (match = orig.match(/dim (\d+)/))
        return parseInt(match[1]);

      return 0;
    };

  } else if (match = s.PossibleSets.match(/(^| )bri(:[^\b\s]*(,(\d+))+)?\b/)) {
    // Hue
    console.debug('detected HUEDevice');
    max = 100;
    if (match[4] !== undefined)
      max = match[4];
    mappings.On = {
      reading: 'onoff',
      valueOff: '0',
      cmdOn: 'on',
      cmdOff: 'off'
    };
    //FIXME: max & maxValue are not set. they would work in both directions. but we use pct for the set cmd. not bri!

    mappings.Brightness = {
      reading: 'pct',
      cmd: 'pct'
    };

  } else if (containsCommand(uid, s, "pct")) {
    // HM dimmer
    mappings.On = {
      reading: 'pct',
      valueOff: '0',
      cmdOn: 'on',
      cmdOff: 'off'
    };
    mappings.Brightness = {
      reading: 'pct',
      cmd: 'pct'
    };

  } else if (match = s.PossibleSets.match(/(^| )dim\d+%/)) {
    // FS20 dimmer
    mappings.On = {
      reading: 'state',
      valueOff: 'off',
      cmdOn: 'on',
      cmdOff: 'off'
    };
    mappings.Brightness = {
      reading: 'state',
      cmd: ' '
    };

    mappings.Brightness.reading2homekit = function (mapping, orig) {
      var match;
      if (orig === 'off')
        return 0;
      else if (match = orig.match(/dim(\d+)%?/))
        return parseInt(match[1]);

      return 100;
    };

    mappings.Brightness.homekit2reading = function (mapping, orig) {
      var dim_values = ['dim06%', 'dim12%', 'dim18%', 'dim25%', 'dim31%', 'dim37%', 'dim43%',
        'dim50%', 'dim56%', 'dim62%', 'dim68%', 'dim75%', 'dim81%', 'dim87%', 'dim93%'
      ];
      //if( value < 3 )
      //  value = 'off';
      //else
      if (orig > 97)
        return 'on';

      return dim_values[Math.round(orig / 625)];
    };
  }

  if (containsCommand(uid, s, 'rgb:colorpicker')) {
    //Hue RGB mode
    if (s.Readings.rgb) {
      mappings.RGB = {
        reading: 'rgb',
        cmd: 'rgb'
      };
      mappings.RGB.reading2homekit = function (mapping, orig) {
        return parseInt('0x' + orig);
      };
      mappings.RGB.homekit2reading = function (mapping, orig) {
        return ("000000" + orig.toString(16)).substr(-6);
      };
    }

    if (s.Readings.colormode) {
      mappings.ColorMode = {
        reading: 'colormode',
        valueCt: 'ct'
      };
    }
    if (s.Readings.ct) {
      mappings.ColorTemperature = {
        reading: 'ct',
        cmd: 'ct'
      };
      mappings.ColorTemperature.reading2homekit = function (mapping, orig) {
        var match;
        if (match = orig.match(/^(\d+) \((\d+)K\)/)) {
          return parseInt(match[2]);
        }
        return 0;
      };
      mappings.ColorTemperature.homekit2reading = function (mapping, orig) {
        //kelvin to mired
        return parseInt(1000000 / orig);
      };
    }

    if (s.Readings.reachable) {
      mappings.Errors.deviceOffline = {
        reading: 'reachable',
        valueError: '0'
      };
    }
  }

  if (containsCommand(uid, s, "effect:none,colorloop")) {
    mappings.LightEffectsColorLoop = {
      reading: 'effect',
      values: ['/colorloop/:colorLoop', '/.*/:none'],
      cmds: ['colorLoop:effect colorloop', 'none:effect none']
    };
    mappings.LightEffectsSleep = {
      reading: 'pct',
      values: ['/0/:none', '/100/:none', '/.*/:sleep'],
      cmd: 'pct 0'
    };
    mappings.LightEffectsWake = {
      reading: 'pct',
      values: ['/0/:none', '/100/:none', '/.*/:wake'],
      cmd: 'pct 100'
    };
  }

  if (match = s.PossibleSets.match(/(^| )hue(:[^\b\s]*(,(\d+))+)?\b/)) {
    max = 359;
    if (match[4] !== undefined)
      max = match[4];
    mappings.Hue = {
      reading: 'hue',
      cmd: 'hue',
      max: max,
      maxValue: 359
    };
  }

  if (match = s.PossibleSets.match(/(^| )sat(:[^\b\s]*(,(\d+))+)?\b/)) {
    max = 100;
    if (match[4] !== undefined)
      max = match[4];
    mappings.Saturation = {
      reading: 'sat',
      cmd: 'sat',
      max: max,
      maxValue: 1
    };
  }

  if (s.Internals.TYPE === 'MilightDevice' &&
    s.PossibleSets.match(/(^| )dim\b/)) {
    // MilightDevice
    uidlog(uid, 'detected MilightDevice');
    mappings.Brightness = {
      reading: 'brightness',
      cmd: 'dim',
      max: 100,
      maxValue: 100
    };
    if (s.PossibleSets.match(/(^| )hue\b/) && s.PossibleSets.match(/(^| )saturation\b/)) {
      mappings.Hue = {
        reading: 'hue',
        cmd: 'hue',
        max: 359,
        maxValue: 359
      };
      mappings.Saturation = {
        reading: 'saturation',
        cmd: 'saturation',
        max: 100,
        maxValue: 1
      };
      mappings.HSVBrightness = {
        reading: 'brightness',
        cmd: 'dim',
        max: 100,
        maxValue: 1
      };
    }

  } else if (s.Internals.TYPE === 'WifiLight' && s.PossibleSets.match(/(^| )RGB\b/) &&
    s.Readings.hue !== undefined && s.Readings.saturation !== undefined && s.Readings.brightness !== undefined) {
    // WifiLight
    uidlog(uid, 'detected WifiLight');
    mappings.RGB = {
      reading: 'RGB',
      cmd: 'RGB'
    };
    mappings.RGB.reading2homekit = function (mapping, orig) {
      return parseInt('0x' + orig);
    };
    mappings.RGB.homekit2reading = function (mapping, orig) {
      return ("000000" + orig.toString(16)).substr(-6);
    };
    mappings.Brightness = {
      reading: 'brightness',
      cmd: 'dim',
      max: 100,
      maxValue: 100
    };
  }

  //TODO move to TYPE and GENERIC for RGB
  if (!mappings.RGB || s.Internals.TYPE === 'SWAP_0000002200000003') {
    // rgb/RGB
    let reading = undefined;
    let cmd = undefined;
    if (s.PossibleSets.match(/(^| )rgb\b/)) {
      reading = 'rgb';
      cmd = 'rgb';
      if (s.Internals.TYPE === 'SWAP_0000002200000003')
        reading = '0B-RGBlevel';
    } else if (s.PossibleSets.match(/(^| )RGB\b/)) {
      reading = 'RGB';
      cmd = 'RGB';
    }

    if (reading && cmd && s.Readings[reading]) {
      mappings.RGB = {
        reading: reading,
        cmd: cmd
      };
      mappings.RGB.reading2homekit = function (mapping, orig) {
        return parseInt('0x' + orig);
      };
      mappings.RGB.homekit2reading = function (mapping, orig) {
        return ("000000" + orig.toString(16)).substr(-6);
      };
      if (s.PossibleSets.match(/(^| )pct\b/) && s.Readings.pct) {
        mappings.Brightness = {
          reading: 'pct',
          cmd: 'pct',
          max: 100,
          maxValue: 100
        };
      } else if (s.PossibleSets.match(/(^| )bright\b/) && s.Readings.bright) {
        mappings.Brightness = {
          reading: 'bright',
          cmd: 'bright',
          max: 100,
          maxValue: 100
        };
      }
    }
  }

  if (s.Internals.TYPE == 'LightScene' || (s.PossibleSets.match(/(^| )scene\b/) && service_name === "scene")) {
    //name attribut ist der name der scene
    mappings.Scene = [];
    let m;
    if (m = s.PossibleSets.match(/(^| )scene:(\S+)\b/)) {
      let availableScenes = m[2].split(",");
      availableScenes.forEach(function (scene) {
        mappings.Scene.push({
          scenename: scene,
          cmdOn: 'scene ' + scene
        })
      }.bind(this));
    }
  }

  if (s.Internals.TYPE == 'BOTVAC') {
    if (!service_name) service_name = 'vacuum';
    mappings.On = {
      reading: 'stateId',
      valueOff: '2',
      cmdOn: 'startCleaning',
      cmdOff: 'stop'
    };
    mappings.Dock = {
      reading: 'isDocked',
      cmd: 'sendToBase',
      values: ['/1/:true', '/.*/:false']
    };
    mappings.StartStop = {
      reading: 'stateId',
      cmdPause: 'pause',
      cmdUnpause: 'startCleaning',
      cmdOn: 'startCleaning',
      cmdOff: 'sendToBase',
      values: ['/3/:paused', '/2/:running', '/.*/:other']
    };
    mappings.Modes = [{
      reading: 'cleaningMode',
      cmd: 'nextCleaningMode',
      mode_attributes: {
        name: 'suction',
        name_values: [{
          name_synonym: ['suction'],
          lang: 'en'
        },
        {
          name_synonym: ['saugkraft', 'saugstärke'],
          lang: 'de'
        }
        ],
        settings: [{
          setting_name: 'eco',
          setting_values: [{
            setting_synonym: ['eco'],
            lang: 'de'
          }]
        },
        {
          setting_name: 'turbo',
          setting_values: [{
            setting_synonym: ['turbo'],
            lang: 'de'
          }]
        }
        ],
        ordered: true
      }
    }];
  }

  if ((s.PossibleSets.match(/(^| )closes\b/) && s.PossibleSets.match(/(^| )opens\b/)) ||
    (s.PossibleSets.match(/(^| )up\b/) && s.PossibleSets.match(/(^| )down\b/) && (genericType === 'blinds' || genericType === 'shutter')) ||
    (s.Internals.TYPE === 'SOMFY' && s.Attributes.model === 'somfyshutter') ||
    (s.Internals.SUBTYPE === 'RolloTron Standard') ||
    (s.Attributes.subType === 'blindActuator') ||
    (s.Internals.TYPE === "UNIRoll") ||
    (s.Attributes.model === 'fs20rsu') ||
    (s.Internals.ccutype === 'HmIP-FROLL') ||
    genericType === 'blinds' || genericType === 'shutter') {
    if (!service_name) service_name = 'blinds';
    delete mappings.On;
    delete mappings.Brightness;
    let open = 'opens';
    let close = 'closes';
    let valClosed = 'closed';
    if (s.Internals.TYPE !== 'EnOcean') {
      if (s.PossibleSets.match(/(^| )on\b/))
        open = 'on';

      if (s.PossibleSets.match(/(^| )off\b/))
        close = 'off';
    } else if (s.Internals.TYPE === 'SOMFY' && s.Attributes.model === 'somfyshutter') {
      open = 'off';
      close = 'on';
      valClosed = 'on';
    }

    if (s.Internals.TYPE === 'DUOFERN') {
      open = 'up';
      close = 'down';
    } else if (s.Attributes.model === 'fs20rsu' || s.Internals.TYPE === 'HM485') {
      open = 'on';
      close = 'off';
      valClosed = 'off';
    } else if (s.Internals.ccutype === "HmIP-FROLL") {
      open = 'pct 100';
      close = 'pct 0';
      valClosed = 'closed';
    } else if (s.Internals.TYPE === "MQTT2_DEVICE") {
      if (s.Attributes.model === "shelly25_roller_invert_0") {
        open = "open";
        close = "close";
        valClosed = "closed";
      }
    } else if (s.Internals.TYPE === "UNIRoll") {
      open = "up";
      close = "down";
      valClosed = "down";

      mappings.TargetPosition = {
        reading: 'state',
        cmd: 'pos',
        max: s.Attributes.rMax,
        min: s.Attributes.rMin,
        maxValue: 100,
        minValue: 0,
        format: 'int'
      };
    }
    mappings.OpenClose = {
      reading: 'state',
      values: ['/^' + valClosed + '/:CLOSED', '/.*/:OPEN'],
      cmdOpen: open,
      cmdClose: close
    };
    if (s.PossibleSets.match(/(^| )position\b/)) {
      mappings.CurrentPosition = {
        reading: 'position',
        invert: true
      };
      mappings.TargetPosition = {
        reading: 'position',
        cmd: 'position',
        invert: true
      };
      if (s.Internals.TYPE == 'SOMFY') {
        mappings.CurrentPosition.invert = false;
        mappings.TargetPosition.invert = false;
        if (s.Internals.TYPE === 'SOMFY')
          mappings.TargetPosition.cmd = 'pos';
      }
    } else if (s.Internals.TYPE == 'ZWave') {
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^off/:CLOSED', '/.*/:OPEN'],
        cmdOpen: 'on',
        cmdClose: 'off',
        max: 99
      };
      if (s.Readings.position !== undefined) {
        // FIBARO System FGRM222 Roller Shutter Controller 2
        // If the device is configured to use Fibaro command class instead of ZWave command class,
        // then there's a reading "position" present which must be used instead.
        mappings.CurrentPosition = {
          reading: 'position',
          invert: true
        };
        mappings.TargetPosition = {
          reading: 'position',
          cmd: 'dim',
          invert: true
        };
      } else {
        mappings.CurrentPosition = {
          reading: 'state',
          invert: true
        };
        mappings.TargetPosition = {
          reading: 'state',
          cmd: 'dim',
          invert: true
        };
      }
    } else if (s.PossibleSets.match(/(^| )pct\b/)) {
      mappings.CurrentPosition = {
        reading: 'pct',
        invert: true
      };
      mappings.TargetPosition = {
        reading: 'pct',
        cmd: 'pct',
        invert: true
      };
      if (s.Attributes.model === "HM-LC-BL1PBU-FM" || (s.Attributes.param && s.Attributes.param.match(/levelInverse/i) || s.Attributes.model === "ROTO_ZEL-STG-RM-FEP-230V")) {
        mappings.CurrentPosition.invert = false;
        mappings.TargetPosition.invert = false;
      }
    } else if (s.PossibleSets.match(/(^| )level\b/)) {
      mappings.CurrentPosition = {
        reading: 'level',
        invert: true
      };
      mappings.TargetPosition = {
        reading: 'level',
        cmd: 'level',
        invert: true
      };
      if (s.Internals.TYPE === 'HM485') {
        mappings.OpenClose.values = ['/^level_100/:CLOSED', '/.*/:OPEN'];
      }
    }

  } else if ((genericType == 'blinds' || genericType == 'shutter') && s.PossibleSets.match(/(^| )open\b/) && s.PossibleSets.match(/(^| )close\b/)) {
    mappings.OpenClose = {
      reading: 'state',
      values: ['/^close/:CLOSED', '/.*/:OPEN'],
      cmdOpen: 'open',
      cmdClose: 'close'
    };

  } else if (s.Attributes.model === 'HM-SEC-WIN') {
    if (!service_name) service_name = 'window';
    mappings.CurrentPosition = {
      reading: 'state',
      invert: true
    };
    mappings.TargetPosition = {
      reading: 'state',
      cmd: ' ',
      invert: true
    };

    var reading2homekit = function (mapping, orig) {
      var match;
      if (match = orig.match(/^(\d+)/))
        return parseInt(match[1]);
      else if (orig == 'locked')
        return 0;

      return 50;
    };
    mappings.CurrentPosition.reading2homekit = reading2homekit;
    mappings.TargetPosition.reading2homekit = reading2homekit;

    mappings.TargetPosition.homekit2reading = function (mapping, orig) {
      if (orig == 0) return 'lock';
      return orig;
    };

  } else if (s.Attributes.model && s.Attributes.model.match(/^HM-SEC-KEY/)) {
    if (!service_name) service_name = 'lock';
    mappings.LockCurrentState = {
      reading: 'lock',
      values: ['/uncertain/:JAMMED', '/^locked/:SECURED', '/.*/:UNSECURED']
    };
    mappings.LockTargetState = {
      reading: 'lock',
      values: ['/^locked/:SECURED', '/.*/:UNSECURED'],
      cmds: ['SECURED:lock', 'UNSECURED:unlock'],
    };

  } else if (s.Internals.TYPE === 'CUL_FHTTK') {
    if (!service_name) service_name = 'door';
    mappings.OpenClose = {
      reading: 'Window',
      values: ['/^Closed/:CLOSED', '/.*/:OPEN']
    };

  } else if (s.Internals.TYPE == 'MAX' &&
    s.Internals.type == 'ShutterContact') {
    if (!service_name) service_name = 'door';
    mappings.OpenClose = {
      reading: 'state',
      values: ['/^closed/:CLOSED', '/.*/:OPEN']
    };

  } else if (s.Attributes.subType == 'threeStateSensor') {
    if (!service_name) service_name = 'door';
    mappings.OpenClose = {
      reading: 'contact',
      values: ['/^closed/:CLOSED', '/.*/:OPEN']
    };

  } else if (s.Internals.TYPE == 'PRESENCE') {
    if (!service_name) service_name = 'light';
    mappings.OccupancyDetected = {
      reading: 'state',
      values: ['present:true', 'absent:false']
    };

  } else if (s.Internals.TYPE == 'ROOMMATE' || s.Internals.TYPE == 'GUEST') {
    if (!service_name) service_name = 'light';
    mappings.OccupancyDetected = {
      reading: 'presence',
      values: ['/present/:true', '/.*/:false']
    };

  } else if (s.Internals.TYPE == 'RESIDENTS') {
    if (!service_name) service_name = 'light';
    mappings.OccupancyDetected = {
      reading: 'state',
      values: ['/^home/:true', '/^gotosleep/:true', '/^absent/:false', '/^gone/:false']
    }
  } else if (s.Internals.TYPE === 'FBDECT') {
    if (s.Internals.DEF && s.Internals.DEF.match(/HANFUN2,alarmSensor/)) {
      if (!service_name) service_name = 'door';
      mappings.OpenClose = {
        reading: 'state',
        values: ['/off/:CLOSED', '/.*/:OPEN']
      };
    } else if (s.Internals.DEF && s.Internals.DEF.match(/actuator,tempSensor/)) {
      if (!service_name) service_name = 'thermostat';
      if (mappings.TargetTemperature) {
        mappings.TargetTemperature.part = 0;
      }
    }
  }

  if (match = s.PossibleSets.match(/(^| )desired-temp(:[^\d]*([^\$ ]*))?/)) {
    //HM & Comet DECT
    mappings.TargetTemperature = {
      reading: 'desired-temp',
      cmd: 'desired-temp'
    };
    if (s.Readings['desired-temp'] === undefined) //Comet DECT
      mappings.TargetTemperature.reading = 'temperature';

    // if (s.Readings.actuator)
    //     mappings.Actuation = {
    //         reading: 'actuator',
    //         name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
    //         maxValue: 100, minValue: 0, minStep: 1
    //     };
    // else if (s.Readings.ValvePosition)
    //     mappings.Actuation = {
    //         reading: 'ValvePosition',
    //         name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
    //         maxValue: 100, minValue: 0, minStep: 1
    //     };
    // else if (s.Readings.valvePosition)
    //     mappings.Actuation = {
    //         reading: 'valvePosition',
    //         name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
    //         maxValue: 100, minValue: 0, minStep: 1
    //     };

    if (match[3]) {
      var values = match[3].split(',');
      if (match[3].match(/slider/)) {
        mappings.TargetTemperature.minValue = parseFloat(values[0]);
        mappings.TargetTemperature.maxValue = parseFloat(values[2]);
        mappings.TargetTemperature.minStep = parseFloat(values[1]);
      } else {
        if (values.length === 4) {
          mappings.TargetTemperature.minValue = parseFloat(values[0]);
          mappings.TargetTemperature.maxValue = parseFloat(values[2]);
          mappings.TargetTemperature.minStep = parseFloat(values[1]);
        } else {
          mappings.TargetTemperature.minValue = parseFloat(values[0]);
          mappings.TargetTemperature.maxValue = parseFloat(values[values.length - 1]);
          mappings.TargetTemperature.minStep = values[1] - values[0];
        }
      }
    }

    if (match = s.PossibleSets.match(/(^| )mode($| )/)) {
      mappings.TargetHeatingCoolingState = {
        reading: 'mode',
        values: ['/^auto/:AUTO', '/^holiday_short/:OFF', '/.*/:HEAT'],
        cmds: ['OFF:mode holiday_short', 'HEAT:mode manual', 'COOL:mode manual', 'AUTO:mode auto'],
      };
    }

  } else if (match = s.PossibleSets.match(/(^| )desiredTemperature(:[^\d]*([^\$ ]*))?/)) {
    // MAX / EQ3BT
    mappings.TargetTemperature = {
      reading: 'desiredTemperature',
      cmd: 'desiredTemperature'
    };

    if (s.Readings.valvePosition) {
      mappings.OpenClose = {
        reading: 'valvePosition',
        values: ['0:CLOSED', '/.*/:OPEN']
      };
      mappings.CurrentPosition = {
        reading: 'valvePosition'
      };
    }

    if (match[3]) {
      var values = match[3].split(',');
      mappings.TargetTemperature.minValue = parseFloat(values[0]);
      mappings.TargetTemperature.maxValue = parseFloat(values[values.length - 2]);
      if (s.Readings.valvePosition)
        mappings.TargetTemperature.minStep = parseFloat(values[1]);
      else
        mappings.TargetTemperature.minStep = parseFloat(values[1] - values[0]);
    }

    if (s.Readings.ecoMode) {
      mappings.ThermostatModes = {
        reading: ['desiredTemperature', 'ecoMode', 'mode'],
        cmds: ['auto:mode automatic', 'off:mode manual;desiredTemperature 4.5', 'heat:mode manual;comfort', 'eco:eco', 'on:comfort'],
        values: ['mode=/Auto/:auto', 'ecoMode=/1/:eco', 'desiredTemperature=/^4.5/:off', 'desiredTemperature=/.*/:heat']
      };
      mappings.Toggles = [{
        reading: 'boost', valueOn: '1', cmdOn: 'boost on', cmdOff: 'boost off',
        toggle_attributes: {
          name: 'Boost',
          name_values: [
            {
              name_synonym: ['boost', 'boost mode'],
              lang: 'en'
            },
            {
              name_synonym: ['boost', 'boost modus', 'aufheizen', 'schnell heiz modus', 'schnellheizmodus'],
              lang: 'de'
            }
          ]
        }
      }];
    } else if (s.Readings.mode) {
      mappings.ThermostatModes = {
        reading: ['desiredTemperature', 'mode'],
        cmds: ['heat:desiredTemperature comfort', 'eco:desiredTemperature eco', 'auto:desiredTemperature auto', 'on:desiredTemperature comfort', 'off:desiredTemperature off'],
        values: ['mode=/auto/:auto', 'desiredTemperature=/off/:off', 'mode=/eco/:eco', 'mode=/.*/:heat']
      };
      mappings.Toggles = [{
        reading: 'mode', valueOn: 'boost', cmdOn: 'desiredTemperature boost', cmdOff: 'desiredTemperature comfort',
        toggle_attributes: {
          name: 'Boost',
          name_values: [
            {
              name_synonym: ['boost', 'boost mode'],
              lang: 'en'
            },
            {
              name_synonym: ['boost', 'boost modus', 'aufheizen', 'schnell heiz modus', 'schnellheizmodus'],
              lang: 'de'
            }
          ]
        }
      }];
    }
  } else if (match = s.PossibleSets.match(/(^| )desired(:[^\d]*([^\$ ]*))?/)) {
    //PID20
    mappings.TargetTemperature = {
      reading: 'desired',
      cmd: 'desired'
    };

    // if (s.Readings.actuation)
    //     mappings.Actuation = {
    //         reading: 'actuation',
    //         name: 'Actuation', format: 'UINT8', unit: 'PERCENTAGE',
    //         maxValue: 100, minValue: 0, minStep: 1
    //     };

    if (s.Readings.measured)
      mappings.CurrentTemperature = {
        reading: 'measured'
      };

  }

  if (s.Internals.TYPE == 'SONOSPLAYER') { //FIXME: use sets [Pp]lay/[Pp]ause/[Ss]top
    mappings.On = {
      reading: 'transportState',
      valueOn: 'PLAYING',
      cmdOn: 'play',
      cmdOff: 'pause'
    };

    mappings.mediaPause = {
      cmd: 'pause'
    };
    mappings.mediaNext = {
      cmd: 'next'
    };
    mappings.mediaPrevious = {
      cmd: 'previous'
    };
    mappings.mediaResume = {
      cmd: 'play'
    };
    mappings.mediaStop = {
      cmd: 'stop'
    };

  } else if (s.Internals.TYPE == 'harmony') {
    if (!service_name) service_name = 'switch';

    var match;
    if (match = s.PossibleSets.match(/(^| )activity:([^\s]*)/)) {
      mappings.On = [];
      mappings.Volume = [];
      mappings.Mute = [];
      mappings.mediaPause = [];
      mappings.mediaNext = [];
      mappings.mediaPrevious = [];
      mappings.mediaResume = [];
      mappings.mediaStop = [];

      for (var activity of match[2].split(',')) {
        if (activity == "PowerOff")
          continue;

        mappings.On.push({
          virtualdevice: activity,
          cmdOn: 'activity ' + activity,
          cmdOff: 'off'
        });
        mappings.Volume.push({
          virtualdevice: activity,
          cmdUp: "command volumeUp",
          cmdDown: "command volumeDown",
          levelStepSize: 3
        });
        mappings.Mute.push({
          virtualdevice: activity,
          cmdOn: "command mute",
          cmdOff: "command mute"
        });
        mappings.mediaPause.push({
          virtualdevice: activity,
          cmd: 'command Pause'
        });
        mappings.mediaNext.push({
          virtualdevice: activity,
          cmd: 'command SkipForward'
        });
        mappings.mediaPrevious.push({
          virtualdevice: activity,
          cmd: 'command SkipBackward'
        });
        mappings.mediaResume.push({
          virtualdevice: activity,
          cmd: 'command Play'
        });
        mappings.mediaStop.push({
          virtualdevice: activity,
          cmd: 'command Stop'
        });
      }
    }

  } else if (!mappings.On && !mappings.OpenClose &&
    s.PossibleSets.match(/(^| )on\b/) &&
    s.PossibleSets.match(/(^| )off\b/)) {
    mappings.On = {
      reading: 'state',
      valueOff: '/off|A0|000000/',
      cmdOn: 'on',
      cmdOff: 'off'
    };
    if (!s.Readings.state)
      delete mappings.On.reading;

  } else if (!mappings.On && !mappings.OpenClose &&
    s.PossibleSets.match(/(^| )ON\b/) &&
    s.PossibleSets.match(/(^| )OFF\b/)) {
    mappings.On = {
      reading: 'state',
      valueOff: '/OFF/off/',
      cmdOn: 'ON',
      cmdOff: 'OFF'
    };
    if (!s.Readings.state)
      delete mappings.On.reading;

  } else if (!service_name && s.Attributes.setList) {
    var parts = s.Attributes.setList.split(' ');
    if (parts.length == 2) {
      service_name = 'switch';
      mappings.On = {
        reading: 'state',
        valueOn: parts[0],
        cmdOn: parts[0],
        cmdOff: parts[1]
      };
    }

  }

  //TRAITS BASED ON POSSIBLE COMMANDS
  if (!mappings.Timer && containsCommand(uid, s, "on-for-timer")) {
    mappings.Timer = {
      commandOnlyTimer: true,
      maxTimerLimitSec: 86400,
      cmdTimerStart: "on-for-timer",
      cmdTimerCancel: "on-for-timer 0"
    };
  }
  if (!mappings.Brightness && containsCommand(uid, s, "dim:slider,0,1,100") && s.Readings.dim) {
    mappings.Brightness = {
      reading: 'dim',
      cmd: 'dim'
    };
  }

  //GENERIC MAPPINGS BASED ON READINGS
  //only set when mapping was not set before
  if (s.Readings['measured-temp'] && !mappings.CurrentTemperature) {
    mappings.CurrentTemperature = {
      reading: 'measured-temp',
      minValue: -30
    };
  } else if (s.Readings.temperature && !mappings.CurrentTemperature) {
    mappings.CurrentTemperature = {
      reading: 'temperature',
      minValue: -30
    };
  }

  if (s.Readings.volume && !mappings.Volume) {
    mappings.Volume = {
      reading: 'volume',
      cmd: 'volume',
      levelStepSize: 3
    };
  } else if (s.Readings.Volume && !mappings.Volume) {
    mappings.Volume = {
      reading: 'Volume',
      cmd: 'Volume',
      levelStepSize: 3
    };
  }

  if (s.Readings.humidity && !mappings.CurrentRelativeHumidity) {
    mappings.CurrentRelativeHumidity = {
      reading: 'humidity'
    };
  }

  if (s.Readings.battery || s.Readings.batteryState) {
    var batt = s.Readings.battery ? "battery" : "batteryState";
    mappings.Exceptions.lowBattery = {
      reading: batt,
      values: ['/low/:EXCEPTION', '/^[0-1]?[0-9]$/:EXCEPTION', '/.*/:OK'],
      onlyLinkedInfo: false
    };

    mappings.EnergyStorageDescriptive = {
      queryOnlyEnergyStorage: true,
      reading: batt,
      values: ["/^[0]?[0-9]$/:CRITICALLY_LOW",
        "/^[1][0-9]$/:LOW",
        "/^[2-7][0-9]$/:MEDIUM",
        "/^[8][0-9]$/:HIGH",
        "/^[1]?[0,9][0-9]$/:FULL",
        "/low/:CRITICALLY_LOW",
        "/.*/:FULL"]
    };

    if ((s.Readings.battery && !isNaN(s.Readings.battery.Value)) || (s.Readings.batteryState && !isNaN(s.Readings.batteryState.Value))) {
      var r = isNaN(s.Readings.battery.Value) ? "batteryState" : "battery";
      mappings.EnergyStorageExact = [{
        queryOnlyEnergyStorage: true,
        reading: r,
        unit: "PERCENTAGE"
      }];
    }
    if (mappings.EnergyStorageExact)
      delete mappings.EnergyStorageDescriptive;
  }

  //if (s.Readings.pressure)
  //    mappings.AirPressure = {
  //        name: 'AirPressure',
  //        reading: 'pressure',
  //        format: 'UINT16',
  //        factor: 1
  //    };

  //DEVICE SPECIFIC MAPPINGS BASED ON TYPE
  if (s.Internals.TYPE === 'gassistant') {
    if (!service_name) service_name = 'switch';
    mappings.SoftwareUpdate = {
      cmd: 'reload'
    };
    mappings.Reboot = {
      cmd: 'restart'
    };
  } else if (s.Internals.TYPE === "SIRD") {
    mappings.Volume = {
      reading: "volume",
      cmd: "volume",
      levelStepSize: 5
    };
  } else if (s.Internals.TYPE === "HVAC_DaikinAC") {
    if (!service_name) service_name = 'ac_unit';
    //mode:vent,auto,cool,dehumidify,heat,auto
    //swing:horizontal,vertical,3d,none
    mappings.SimpleModes = [{
      reading: "mode",
      name: "Modus",
      "auto,automatisch": "mode auto",
      "entlüften,lüftern": "mode vent",
      "cool,kühlen": "mode cool",
      "entfeuchten": "mode dehumidify",
      "heizen,wärmen": "mode heat"
    },{
      reading: "swing",
      name: "Schwenken",
      "horizontal": "swing horizontal",
      "vertikal": "swing vertical",
      "3d": "swing 3d",
      "aus": "swing none"
    }];
    //rate:silent,lowest,medium,high,auto,highest,low
    mappings.FanSpeed = {
      reading: 'rate', speeds: {
        'S1': { 'cmd': 'rate silent', value: 'silent', 'synonyms': { 'de': ['leise'] } },
        'S2': { 'cmd': 'rate lowest', value: 'lowest', 'synonyms': { 'de': ['sehr schwach'] } },
        'S3': { 'cmd': 'rate low', value: 'low', 'synonyms': { 'de': ['schwach'] } },
        'S4': { 'cmd': 'rate medium', value: 'medium', 'synonyms': { 'de': ['mittel'] } },
        'S5': { 'cmd': 'rate high', value: 'high', 'synonyms': { 'de': ['stark'] } },
        'S6': { 'cmd': 'rate highest',value: 'highest', 'synonyms': { 'de': ['sehr stark'] } },
        'S7': { 'cmd': 'rate auto',value: 'auto', 'synonyms': { 'de': ['auto'] } }
      }, ordered: true, reversible: false
    };
    //powerful:on,off
    //econo:on,off
    //streamer:on,off
    mappings.SimpleToggles = [{
      cmdOn: 'powerful on',
      cmdOff: 'powerful off',
      voicecmd: 'Power Modus'
    }, {
      cmdOn: 'econo off',
      cmdOff: 'econo on',
      voicecmd: 'ECO Modus'
    }, {
      cmdOn: 'streamer on',
      cmdOff: 'streamer off',
      voicecmd: 'Luftreinigung'
    }];
    //stemp:slider,18,0.5,30
    mappings.TargetTemperature = {
      reading: 'stemp',
      cmd: 'stemp',
      minValue: 10,
      maxValue: 30,
      minStep: 0.5
    };
    mappings.CurrentTemperature = {
      reading: 'htemp'
    };
  } else if (s.Internals.TYPE === "PythonModule") {
    if (s.Internals.PYTHONTYPE === "eq3bt") {
      if (!service_name) service_name = "thermostat";
      mappings.TargetTemperature = {
        reading: 'desiredTemperature',
        cmd: 'desiredTemperature'
      };
      mappings.TargetTemperature.minValue = 4.5;
      mappings.TargetTemperature.maxValue = 30;
      mappings.TargetTemperature.minStep = 0.5;
      
      mappings.OpenClose = {
        reading: 'valvePosition',
        values: ['0:CLOSED', '/.*/:OPEN']
      };
      mappings.CurrentPosition = {
        reading: 'valvePosition'
      };
  
      mappings.ThermostatModes = {
        reading: ['desiredTemperature', 'ecoTemperature', 'mode'],
        cmds: ['auto:mode automatic', 'off:mode manual;desiredTemperature 4.5', 'heat:mode manual;comfort', 'eco:eco', 'on:comfort'],
        values: ['mode=/auto/:auto', 'desiredTemperature=/^4.5/:off', 'desiredTemperature=/.*/:heat']
      };
      mappings.Toggles = [{
        reading: 'boost', valueOn: '1', cmdOn: 'boost on', cmdOff: 'boost off',
        toggle_attributes: {
          name: 'Boost',
          name_values: [
            {
              name_synonym: ['boost', 'boost mode'],
              lang: 'en'
            },
            {
              name_synonym: ['boost', 'boost modus', 'aufheizen', 'schnell heiz modus', 'schnellheizmodus'],
              lang: 'de'
            }
          ]
        }
      }];
    } else if (s.Internals.PYTHONTYPE === "xiaomi_gateway3_device") {
      if (s.Readings.model && s.Readings.model.Value === "lumi.sensor_magnet.v2") {
        if (!service_name) service_name = 'door';
        mappings.OpenClose = {
          reading: 'state',
          values: ['/^closed/:CLOSED', '/.*/:OPEN']
        };
      } else if (s.Readings.model && s.Readings.model.Value === "sensor_wleak.aq1") {
        if (!service_name) service_name = 'sensor';
        mappings.WaterLeak = {
          reading: "state",
          values: ["leak:leak", "no_leak:no leak", "/.*/:unknown"]
        };
        mappings.Exceptions.waterLeakDetected = {
          reading: 'state',
          values: ['leak:EXCEPTION', '/.*/:OK'],
          onlyLinkedInfo: false
        };
      }
    }
  } else if (s.Internals.TYPE === "KLF200Node") {
    if (!service_name) service_name = 'blinds';
    mappings.OpenClose = {
      reading: 'state',
      values: ['/^off/:CLOSED', '/^on/:OPEN'],
      cmdOpen: 'on',
      cmdClose: 'off'
    };
    mappings.CurrentPosition = {
      reading: 'pct'
    };
    mappings.TargetPosition = {
      reading: 'pct',
      cmd: 'pct'
    };
  } else if (s.Internals.TYPE === 'FRITZBOX') {
    if (!service_name) service_name = 'router';
    mappings.GuestNetwork = {
      cmdOn: 'guestWlan on',
      cmdOff: 'guestWlan off',
      reading: 'box_guestWlan',
      valueOff: 'off'
    };
    mappings.ConnectedDevices = {
      reading: 'box_wlanCount'
    };
    mappings.NetworkEnabled = {
      reading: 'box_wlan_2.4GHz',
      valueOff: 'off'
    };
    mappings.SoftwareUpdate = {
      cmd: 'update'
    };
  } else if (s.Internals.TYPE === 'LaCrosse') {
    if (!service_name) service_name = 'sensor';
  } else if (s.Internals.TYPE === 'ONKYO_AVR') {
    var inputArr = getCommandParams(uid, s, "input");
    var vc = {};
    for (var i of inputArr) {
      vc[i] = i;
    }
    mappings.SimpleInputSelector = {
      cmd: "input",
      voicecmds: vc
    };
    mappings.mediaPause = {
      cmd: 'pause'
    };
    mappings.mediaNext = {
      cmd: 'next'
    };
    mappings.mediaPrevious = {
      cmd: 'previous'
    };
    mappings.mediaResume = {
      cmd: 'play'
    };
    mappings.mediaStop = {
      cmd: 'stop'
    };

    mappings.On = {
      reading: 'power',
      valueOff: 'off',
      cmdOn: 'on',
      cmdOff: 'off'
    };

    mappings.Mute = {
      reading: 'mute',
      valueOff: 'false',
      format: "bool",
      cmdOn: 'mute on',
      cmdOff: 'mute off'
    };
  } else if (s.Internals.TYPE === 'YAMAHA_AVR') {
    var inputArr = getCommandParams(uid, s, "input");
    var vc = {};
    for (var i of inputArr) {
      vc[i] = i;
    }
    mappings.SimpleInputSelector = {
      cmd: "input",
      voicecmds: vc
    };
    mappings.mediaPause = {
      cmd: 'pause'
    };
    mappings.mediaNext = {
      cmd: 'skip forward'
    };
    mappings.mediaPrevious = {
      cmd: 'skip reverse'
    };
    mappings.mediaResume = {
      cmd: 'play'
    };
    mappings.mediaStop = {
      cmd: 'stop'
    };

    mappings.Mute = {
      reading: 'mute',
      valueOff: 'false',
      format: "bool",
      cmdOn: 'mute on',
      cmdOff: 'mute off'
    };
  } else if (s.Internals.TYPE === 'CUL_HM') {
    if (s.Attributes.model === 'HM-SEC-WDS-2') {
      if (!service_name) service_name = 'sensor';
      mappings.WaterLeak = {
        reading: "state",
        values: ["dry:no leak", "/.*/:leak"]
      };
      mappings.Exceptions.waterLeakDetected = {
        reading: 'state',
        values: ['dry:OK', '/.*/:EXCEPTION'],
        onlyLinkedInfo: false
      };
    }
  } else if (s.Internals.TYPE === 'DoorBird') {
    if (!service_name) service_name = 'door';
    mappings.OpenClose = {
      cmdOpen: 'Open_Door 1'
    };
    mappings.SimpleToggles = [{
      cmdOn: 'Open_Door 2',
      voicecmd: 'Licht'
    }, {
      cmdOn: 'Live_Video on',
      cmdOff: 'Live_Video off',
      voicecmd: 'Videoübertragung'
    }, {
      cmdOn: 'Live_Audio on',
      cmdOff: 'Live_Audio off',
      voicecmd: 'Audioübertragung'
    }];
    mappings.Reboot = {
      cmd: 'Restart'
    };
  } else if (s.Internals.TYPE === 'BOSEST') {
    if (!service_name) service_name = 'switch';

    var inputArr = getCommandParams(uid, s, "source");
    var vc = {};
    for (var i of inputArr) {
      vc[i] = i;
    }
    mappings.SimpleInputSelector = {
      reading: "source",
      cmd: "source",
      voicecmds: vc
    };
    mappings.MediaPlaybackState = {
      reading: "state",
      values: ["paused:PAUSED", "playing:PLAYING", "buffering:BUFFERING", "/.*/:STOPPED"]
    };
    mappings.MediaActivityState = {
      reading: "state",
      values: ["paused:INACTIVE", "playing:ACTIVE", "buffering:ACTIVE", "stopped:INACTIVE", "/.*/:STANDBY"]
    };
    mappings.On = {
      reading: 'source',
      valueOff: 'STANDBY',
      cmdOn: 'on',
      cmdOff: 'off'
    };

    mappings.mediaPause = {
      cmd: 'pause'
    };
    mappings.mediaNext = {
      cmd: 'nextTrack'
    };
    mappings.mediaPrevious = {
      cmd: 'prevTrack'
    };
    mappings.mediaResume = {
      cmd: 'play'
    };
    mappings.mediaStop = {
      cmd: 'stop'
    };

    mappings.Mute = {
      reading: 'mute',
      valueOff: 'false',
      format: "bool",
      cmdOn: 'mute on',
      cmdOff: 'mute off'
    };

    var channel_01 = "Sender 1";
    var channel_02 = "Sender 2";
    var channel_03 = "Sender 3";
    var channel_04 = "Sender 4";
    var channel_05 = "Sender 5";
    var channel_06 = "Sender 6";
    if (s.Readings.channel_01)
      channel_01 = s.Readings.channel_01.Value;
    if (s.Readings.channel_02)
      channel_02 = s.Readings.channel_02.Value;
    if (s.Readings.channel_03)
      channel_03 = s.Readings.channel_03.Value;
    if (s.Readings.channel_04)
      channel_04 = s.Readings.channel_04.Value;
    if (s.Readings.channel_05)
      channel_05 = s.Readings.channel_05.Value;
    if (s.Readings.channel_06)
      channel_06 = s.Readings.channel_06.Value;
    mappings.Modes = [{
      reading: 'channel',
      cmds: ['1:channel 1', '2:channel 2', '3:channel 3', '4:channel 4', '5:channel 5', '6:channel 6'],
      values: ['1:1', '2:2', '3:3', '4:4', '5:5', '6:6'],
      mode_attributes: {
        name: 'Preset',
        name_values: [{
          name_synonym: ['Preset', 'Sender'],
          lang: 'en'
        },
        {
          name_synonym: ['Kanal', 'Preset', 'Sender'],
          lang: 'de'
        }
        ],
        settings: [{
          setting_name: '1',
          setting_values: [{
            setting_synonym: [channel_01, 'Sender 1', 'Eins', 'Kanal 1', 'Preset 1'],
            lang: 'de'
          }]
        },
        {
          setting_name: '2',
          setting_values: [{
            setting_synonym: [channel_02, 'Sender 2', 'Zwei', 'Kanal 2', 'Preset 2'],
            lang: 'de'
          }]
        },
        {
          setting_name: '3',
          setting_values: [{
            setting_synonym: [channel_03, 'Sender 3', 'Drei', 'Kanal 3', 'Preset 3'],
            lang: 'de'
          }]
        },
        {
          setting_name: '4',
          setting_values: [{
            setting_synonym: [channel_04, 'Sender 4', 'Vier', 'Kanal 4', 'Preset 4'],
            lang: 'de'
          }]
        },
        {
          setting_name: '5',
          setting_values: [{
            setting_synonym: [channel_05, 'Sender 5', 'Fuenf', 'Kanal 5', 'Preset 5'],
            lang: 'de'
          }]
        },
        {
          setting_name: '6',
          setting_values: [{
            setting_synonym: [channel_06, 'Sender 6', 'Sechs', 'Kanal 6', 'Preset 6'],
            lang: 'de'
          }]
        }],
        ordered: true
      }
    }];
  } else if (s.Internals.TYPE === "GFPROBT") {
    if (!service_name) service_name = "sprinkler";
    mappings.Timer = {
      commandOnlyTimer: true,
      maxTimerLimitSec: 7200,
      cmdTimerStart: "on"
    };
    mappings.On = {
      reading: 'watering',
      valueOff: '0',
      cmdOn: 'on',
      cmdOff: 'off'
    };
    mappings.StartStop = {
      reading: 'watering',
      cmdOn: 'on',
      cmdOff: 'off',
      values: ['/^1/:running', '/.*/:other']
    };
  } else if (s.Internals.TYPE == 'XiaomiDevice') {
    if (s.Attributes.subType == 'VacuumCleaner') {
      if (!service_name) service_name = 'vacuum';
      //segments
      if (containsCommand(uid, s, "segment")) {
        var segmentArr = getCommandParams(uid, s, "segment");
        if (segmentArr.length > 0) {
          mappings.StartStopZones = {
            cmd: "segment",
            availableZones: segmentArr
          };
        }
      }
      //zones
      if (containsCommand(uid, s, "zone") && !mappings.StartStopZones) {
        var zoneArr = getCommandParams(uid, s, "zone");
        mappings.StartStopZones = {
          cmd: "zone",
          availableZones: zoneArr
        };
      }
      mappings.Exceptions.binFull = {
        reading: 'event',
        values: ['/bin_full/:EXCEPTION', '/.*/:OK'],
        onlyLinkedInfo: false
      };
      mappings.On = {
        reading: 'in_cleaning',
        valueOff: 'no',
        cmdOn: 'start',
        cmdOff: 'charge'
      };
      mappings.Dock = {
        reading: 'state',
        cmd: 'charge',
        values: ['/^Docked/:true', '/^Charging/:true', '/.*/:false']
      };
      mappings.FilterCleanliness = {
        reading: "consumables_filter",
        values: ["/^[0-1]?[0-9][0-9]$/:clean", "/^[0-9]$/:dirty", "/^-.*$/:needs replacement", "/.*/:unknown"]
      };
      mappings.Locate = {
        cmd: 'locate'
      };
      //map Paused => paused, Cleaning => running
      mappings.StartStop = {
        reading: 'state',
        cmdPause: 'pause',
        cmdUnpause: 'start',
        cmdOn: 'start',
        cmdOff: 'charge',
        values: ['/^Paused/:paused', '/^Cleaning/:running', '/.*/:other']
      };
      mappings.Modes = [{
        reading: 'cleaning_mode',
        cmd: 'cleaning_mode',
        mode_attributes: {
          name: 'Modus',
          name_values: [{
            name_synonym: ['mode', 'suction'],
            lang: 'en'
          },
          {
            name_synonym: ['Modus', 'saugkraft', 'saugstärke'],
            lang: 'de'
          }
          ],
          settings: [{
            setting_name: 'quiet',
            setting_values: [{
              setting_synonym: ['ruhe', 'ruhe-', 'ruhemodus', 'leise'],
              lang: 'de'
            }]
          },
          {
            setting_name: 'balanced',
            setting_values: [{
              setting_synonym: ['balanced', 'normal'],
              lang: 'de'
            }]
          },
          {
            setting_name: 'turbo',
            setting_values: [{
              setting_synonym: ['turbo'],
              lang: 'de'
            }]
          },
          {
            setting_name: 'max',
            setting_values: [{
              setting_synonym: ['maximum', 'max', 'volle kraft'],
              lang: 'de'
            }]
          }
          ],
          ordered: true
        }
      }];
    } else if (s.Attributes.subType === "SmartFan") {
      if (!service_name) service_name = 'fan';
      mappings.On = {
        reading: 'speed',
        valueOff: '0',
        cmdOn: 'on',
        cmdOff: 'off'
      };
      mappings.SimpleModes = [{
        reading: "mode",
        name: "Modus",
        "normal": "mode straight",
        "natürlich": "mode natural"
      }, {
        reading: "led",
        name: "Beleuchtung",
        "hell": "led bright",
        "gedimmt": "led dim",
        "aus": "led off"
      }, {
        reading: "angle",
        name: "Drehung",
        "30 Grad": "angle 30",
        "60 Grad": "angle 60",
        "90 Grad": "angle 90",
        "120 Grad": "angle 120"
      }];
      mappings.FanSpeed = {
        reading: 'level', speeds: {
          'S1': { 'cmd': 'level 20', value: '20', 'synonyms': { 'de': ['sehr schwach'] } },
          'S2': { 'cmd': 'level 40', value: '40', 'synonyms': { 'de': ['schwach'] } },
          'S3': { 'cmd': 'level 60', value: '60', 'synonyms': { 'de': ['mittel'] } },
          'S4': { 'cmd': 'level 80', value: '80', 'synonyms': { 'de': ['stark'] } },
          'S5': { 'cmd': 'level 100', value: '100', 'synonyms': { 'de': ['sehr stark'] } }
        }, ordered: true, reversible: false
      };
      mappings.SimpleToggles = [{
        reading: 'angle_enable',
        valueOn: 'on',
        cmdOn: 'angle_enable on',
        cmdOff: 'angle_enable off',
        voicecmd: 'Drehung'
      }, {
        reading: 'child_lock',
        valueOn: 'on',
        cmdOn: 'child_lock on',
        cmdOff: 'child_lock off',
        voicecmd: 'Kindersicherung'
      }, {
        reading: 'buzzer',
        valueOn: '1',
        cmdOn: 'buzzer on',
        cmdOff: 'buzzer off',
        voicecmd: 'Ton'
      }];
    }
  } else if (s.Internals.TYPE === 'KNX') {
    var defmatch = s.Internals.DEF.match(/([\S]+:[\S]+)\b/g);
    var servicetmp = 'switch';
    var gadcnt = 1;
    var usedDpts = {};

    for (let i = 0; i < defmatch.length; i++) {
      var reg = /^\S+?:(\S+?)(?=:|$)(\S+?)?(?=:|$)(\S+?)?$/;
      var def = reg.exec(defmatch[i]);
      var dpt = def[1];
      var gadname = def[2] ? def[2].replace(':', '') : '';
      var setget = def[3] ? def[3].replace(':', '') : '';

      if (gadname === '') {
        gadname = 'g' + gadcnt;
      }
      gadcnt++;

      if (setget === 'get' || usedDpts[dpt] !== undefined) {
        if (dpt === 'dpt1.001' && mappings.On) {
          mappings.On.reading.push(gadname, gadname + '-get', gadname + '-set');
        } else if (dpt === 'dpt5.001' && mappings.Brightness) {
          mappings.Brightness.reading.push(gadname, gadname + '-get', gadname + '-set');
        }
        continue;
      }

      if (setget === 'set' || setget === '') {
        //check if dpt was already assigned
        if (usedDpts[dpt] !== undefined)
          continue;

        usedDpts[dpt] = 1;
        if (dpt === 'dpt1.001') {
          mappings.On = {
            reading: [gadname, gadname + '-get', gadname + '-set'],
            selectReading: "lastUpdate",
            valueOff: '/off|0 \%/',
            cmdOn: gadname + ' on',
            cmdOff: gadname + ' off'
          };
        } else if (dpt === 'dpt5.001') {
          servicetmp = 'light';
          mappings.Brightness = {
            reading: [gadname, gadname + '-get', gadname + '-set'],
            selectReading: "lastUpdate",
            part: 0,
            cmd: gadname,
            max: 100,
            maxValue: 100
          };
          // } else if (dpt === 'dpt1.008') {
          //   servicetmp = 'light';
          //   mappings.On = {
          //     reading: 'state',
          //     valueOff: '0 %',
          //     cmdOn: gadname + ' up',
          //     cmdOff: gadname + ' down'
          //   };
        } else {
          delete usedDpts[dpt];
        }
      }
    }
    if (!service_name) service_name = servicetmp;
  } else if (s.Internals.TYPE === 'tahoma') {
    if (s.Internals.SUBTYPE === 'DEVICE' && s.Internals.inControllable === 'rts:BlindRTSComponent') {
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^0/:CLOSED', '/.*/:OPEN'],
        cmdOpen: 'up',
        cmdClose: 'down'
      };
    } else if (s.Internals.inControllable === 'io:RollerShutterVeluxIOComponent') {
      if (!service_name) service_name = 'blinds';
      mappings.OpenClose = {
        reading: 'OpenClosedState',
        values: ['/^closed/:CLOSED', '/.*/:OPEN'],
        cmdOpen: 'open',
        cmdClose: 'close'
      };
      mappings.CurrentPosition = {
        reading: 'ClosureState',
        invert: true
      };
      mappings.TargetPosition = {
        reading: 'ClosureState',
        cmd: 'dim',
        invert: true
      };
    } else if (s.Internals.inControllable === 'io:WindowOpenerVeluxIOComponent') {
      if (!service_name) service_name = 'window';
      mappings.OpenClose = {
        reading: 'OpenClosedState',
        values: ['/^closed/:CLOSED', '/.*/:OPEN'],
        cmdOpen: 'open',
        cmdClose: 'close'
      };
      mappings.CurrentPosition = {
        reading: 'ClosureState',
        invert: true
      };
      mappings.TargetPosition = {
        reading: 'ClosureState',
        cmd: 'dim',
        invert: true
      };
    }
  } else if (s.Internals.TYPE === 'MieleAtHome') {
    var detected = false
    if (s.Readings.deviceType && s.Readings.deviceType.Value === "Waschmaschine") {
      detected = true
      if (!service_name) service_name = 'washer';
    } else if (s.Readings.deviceType && s.Readings.deviceType.Value === "Trockner") {
      detected = true
      if (!service_name) service_name = 'dryer';
    }
    if (detected) {
      mappings.On = {
        "reading": "state",
        "values": ["/Off/:off", "/Aus/:off", "/.*/:on"],
        "queryOnlyOnOff": true
      };
      mappings.TemperatureControlAmbientCelsius = {
        "reading": "temperature"
      };
      if (mappings.CurrentTemperature)
        delete mappings.CurrentTemperature;
      if (mappings.TargetTemperature)
        delete mappings.TargetTemperature;
      mappings.RunCycleCurrentCycle = {
        "reading": ["programPhase", "programID", "targetTemperature"]
      };
      mappings.RunCycleCurrentCycle.reading2homekit = function (mapping, readings) {
        return readings['programID'] + " " + readings['targetTemperature'] + " Grad " + readings['programPhase'];
      };
      mappings.RunCycleLang = {
        "fixedValue": "de"
      };
      mappings.RunCycleCurrentTotalRemainingTime = {
        "reading": "remainingTime"
      };
      mappings.RunCycleCurrentTotalRemainingTime.reading2homekit = function (mapping, orig) {
        var a = orig.split(":")
        var seconds = (+a[0]) * 60 * 60 + (+a[1]) * 60; 
        return seconds;
      };
      mappings.RunCycleCurrentCycleRemainingTime = {
        "reading": "remainingTime"
      };
      mappings.RunCycleCurrentCycleRemainingTime.reading2homekit = function (mapping, orig) {
        var a = orig.split(":")
        var seconds = (+a[0]) * 60 * 60 + (+a[1]) * 60; 
        return seconds;
      };
    }
  } else if (s.Internals.TYPE === 'HomeConnect') {
    if (s.Internals.type === 'Washer') {
      if (!service_name) service_name = 'washer';
      mappings.On = {
        reading: 'BSH.Common.Root.ActiveProgram',
        valueOff: '-',
        cmdOn: 'startProgram',
        cmdOff: 'stopProgram'
      };
    } else if (s.Internals.type === 'CoffeeMaker') {
      if (!service_name) service_name = 'coffee_maker';
      mappings.On = {
        reading: "BSH.Common.Setting.PowerState",
        valueOff: 'BSH.Common.EnumType.PowerState.Off',
        cmdOn: 'BSH.Common.Setting.PowerState BSH.Common.EnumType.PowerState.On',
        cmdOff: 'BSH.Common.Setting.PowerState BSH.Common.EnumType.PowerState.Off'
      };
      // Cook
      mappings.CookCurrentCookingMode = {
        "fixedValue": "BREW"
      };
      mappings.CookCurrentFoodQuantity = {
        "fixedValue": 1
      };
      mappings.CookCurrentFoodUnit = {
        "fixedValue": "NO_UNITS"
      };
      mappings.CookCurrentFoodPreset = {
        "reading": "BSH.Common.Root.SelectedProgram",
        "values": ["/^-$/:NONE"]
      };
      mappings.SimpleCook = {
        "supportedCookingModes": ["BREW"],
        "foodPresets": [],
        "params": {
          "foodPreset": {
            "cmds": [],
            "delayAfter": 2
          }
        }
      };
      var supported_units = ["CUPS", "NO_UNITS"];
      for (var prgr of s.Internals.programs.split(",")) {
        // prgr = Beverage.EspressoDoppio
        // preset_name = EspressoDoppio
        // cmd = selectProgram Beverage.EspressoDoppio
        var preset_name = prgr.split(".").slice(-1)[0];
        // Espresso Doppio
        var preset_name_sep = preset_name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        var cmd = "BSH.Common.Root.SelectedProgram " + prgr;
        // Beverage.EspressoDoppio:EspressoDoppio
        mappings.CookCurrentFoodPreset.values.push("/^" + prgr + "$/:" + preset_name);
        // EspressoDoppio, Espresso Doppio
        mappings.SimpleCook.foodPresets.push({
          "food_preset_name": [preset_name, preset_name_sep],
          "supported_units": supported_units
        });
        // EspressoDoppio:selectProgram Beverage.EspressoDoppio
        mappings.SimpleCook.params.foodPreset.cmds.push(preset_name + ":" + cmd);
      }
      // toString needed because auf SimpleCook
      mappings.SimpleCook.cmdFunction = function (mapping, params) {
        var cmds = [];
        if (params.start) {
          cmds.push("startProgram");
        } else {
          cmds.push("stopProgram");
        }
        return cmds;
      }.toString();
    }
  } else if (s.Internals.TYPE === 'ZWave') {
    if (s.Readings.modelId && s.Readings.modelId.Value === "010f-0303-1000") {
      if (!service_name) service_name = "blinds";
      // FIBARO Controller 3
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^off/:OPEN', '/.*/:CLOSED'],
        cmdOpen: 'on',
        cmdClose: 'off'
      };
      mappings.TargetPosition = {
        cmd: 'dim',
        max: 99
      };
      mappings.CurrentPosition = {
        reading: 'state',
        part: 2
      };
    }
    if (s.Attributes['classes'].match(/(^| )THERMOSTAT_SETPOINT\b/)) {
      mappings.TargetTemperature = {
        reading: 'setpointTemp',
        cmd: 'desired-temp',
        part: 0
      };
    } else if (s.Readings.modelId && (s.Readings.modelId.Value === "008a-0004-0101" ||
               s.Readings.modelId.Value === "0109-2001-0106")) {
      if (!service_name) service_name = 'window';
      mappings.OpenClose = {
        reading: 'basicSet',
        values: ['/^0/:CLOSED', '/.*/:OPEN']
      };
    }
    if (s.Attributes['classes'].match(/(^| )THERMOSTAT_MODE\b/) && mappings.TargetTemperature) {
      mappings.ThermostatModes = {
        reading: 'state',
        cmds: ['off:tmOff', 'heat:tmHeating', 'cool:tmCooling', 'auto:tmAuto', 'fan-only:tmFan', 'eco:tmEnergySaveHeating'],
        values: ['/off/:off', '/Cool/:cool', '/Auto/:auto', '/Fan/:fan-only', '/EnergySave/:eco', '/.*/:heat']
      };
      mappings.CurrentTemperature = {
        reading: 'temperature',
        part: 0
      };
    }
  } else if (s.Internals.TYPE === "HMCCUDEV") {
    if (s.Internals.ccutype === "HmIP-BWTH") {
      if (!service_name) service_name = 'thermostat';
      mappings.OpenClose = {
        reading: '10.STATE',
        values: ['0:CLOSED', '1:OPEN']
      };
      mappings.TargetTemperature = {
        reading: '1.SET_POINT_TEMPERATURE',
        cmd: 'datapoint 1.SET_POINT_TEMPERATURE',
        minThresholdCelsius: 5.0,
        maxThresholdCelsius: 30.5
      };
      mappings.CurrentTemperature = {
        reading: '1.ACTUAL_TEMPERATURE'
      };
      mappings.CurrentRelativeHumidity = {
        reading: '1.HUMIDITY'
      };
      mappings.ThermostatModes = {
        reading: ['1.SET_POINT_MODE', '1.SET_POINT_TEMPERATURE'],
        cmds: ['off:off', 'heat:Manual', 'auto:Auto'],
        values: ['1.SET_POINT_TEMPERATURE=/4.5/:off', '1.SET_POINT_MODE=/0/:auto', '1.SET_POINT_MODE=/1/:heat', '/.*/:heat']
      };
      mappings.SimpleToggles = [{
        reading: '1.BOOST_MODE',
        valueOn: '1',
        cmdOn: 'datapoint 1.BOOST_MODE true',
        cmdOff: 'datapoint 1.BOOST_MODE false',
        voicecmd: 'Boost'
      }];
      mappings.Errors.deviceOffline = {
        reading: '0.UNREACH',
        valueError: '1'
      };
    } else if (s.Internals.ccutype === "HmIP-eTRV-2") {
      if (!service_name) service_name = "thermostat";
      mappings.TargetTemperature = {
        reading: 'control',
        cmd: 'control'
      };
      mappings.TargetTemperature.minValue = 4.5;
      mappings.TargetTemperature.maxValue = 30;
      mappings.TargetTemperature.minStep = 0.5;
      mappings.CurrentTemperature = {
        reading: '1.ACTUAL_TEMPERATURE'
      };
      
      mappings.OpenClose = {
        reading: '1.VALVE_STATE',
        values: ['0:CLOSED', '/.*/:OPEN']
      };
      mappings.CurrentPosition = {
        reading: '1.VALVE_STATE'
      };
      mappings.ThermostatModes = {
        reading: ['1.SET_POINT_MODE', '1.SET_POINT_TEMPERATURE'],
        cmds: ['off:off', 'heat:Manual', 'auto:Auto', 'on:on'],
        values: ['1.SET_POINT_TEMPERATURE=/off/:off', '1.SET_POINT_MODE=/0/:auto', '1.SET_POINT_MODE=/1/:heat', '/.*/:heat']
      };
      mappings.Toggles = [{
        reading: '1.BOOST_MODE', valueOn: '1', cmdOn: 'Boost', cmdOff: 'Manual',
        toggle_attributes: {
          name: 'Boost',
          name_values: [
            {
              name_synonym: ['boost', 'boost mode'],
              lang: 'en'
            },
            {
              name_synonym: ['boost', 'boost modus'],
              lang: 'de'
            }
          ]
        }
      }];
    } else if (s.Internals.ccutype === "HmIP-STHO") {
      if (!service_name) service_name = 'sensor';
      mappings.TemperatureControlAmbientCelsius = { "reading": "1.ACTUAL_TEMPERATURE" };
      mappings.CurrentRelativeHumidity = {
        reading: '1.HUMIDITY'
      };
    } else if (s.Internals.ccutype === "HM-CC-RT-DN") {
      mappings.TargetTemperature = {
        reading: '4.SET_TEMPERATURE',
        cmd: 'control',
        minThresholdCelsius: 0.5,
        maxThresholdCelsius: 30.5
      };
      mappings.CurrentTemperature = {
        reading: '4.ACTUAL_TEMPERATURE'
      };
      mappings.ThermostatModes = {
        reading: ['4.CONTROL_MODE', 'state'],
        cmds: ['off:off', 'heat:Manu', 'auto:Auto'],
        values: ['state=/0/:off', '4.CONTROL_MODE=/^AUTO/:auto', '/.*/:heat']
      };
      mappings.Exceptions.lowBattery = {
        reading: "4.BATTERY_STATE",
        values: ['/[2]\.[0-2]/:EXCEPTION', '/.*/:OK'],
        onlyLinkedInfo: false
      };
      mappings.EnergyStorageDescriptive = {
        queryOnlyEnergyStorage: true,
        reading: "4.BATTERY_STATE",
        values: ["/^[2]\.[0-2]$/:CRITICALLY_LOW", "/^[2]\.[3-4]$/:LOW", "/.*/:FULL"]
      };
      mappings.Toggles = [{
        reading: '4.CONTROL_MODE', valueOn: 'BOOST', cmdOn: 'Boost', cmdOff: 'Manu',
        toggle_attributes: {
          name: 'Boost',
          name_values: [
            {
              name_synonym: ['boost', 'boost mode'],
              lang: 'en'
            },
            {
              name_synonym: ['boost', 'boost modus', 'aufheizen', 'schnell heiz modus', 'schnellheizmodus'],
              lang: 'de'
            }
          ]
        }
      }];
    } else if (s.Internals.ccutype === "HM-Sec-SCo" || s.Internals.ccutype === "HMIP-SWDO"
              || s.Internals.ccutype === "HM-Sec-RHS") {
      if (!service_name) service_name = 'window';
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^closed/:CLOSED', '/.*/:OPEN']
      };
    }
  } else if (s.Internals.TYPE === 'MQTT2_DEVICE') {
    if (s.Attributes.model === "zigbee2mqtt_light_rgb_hex") {
      if (!service_name) service_name = "light";
      mappings.On = {
        reading: 'state',
        valueOff: 'off',
        cmdOn: 'on',
        cmdOff: 'off'
      };
      mappings.Brightness = {
        reading: 'brightness',
        cmd: 'brightness',
        max: 255,
        maxValue: 100
      };
      mappings.RGB = {
        reading: 'hex',
        cmd: 'hex'
      };

      mappings.RGB.reading2homekit = function (mapping, orig) {
        return parseInt('0x' + orig);
      };
      mappings.RGB.homekit2reading = function (mapping, orig) {
        return ("000000" + orig.toString(16)).substr(-6);
      };
    } else if (s.Attributes.model === "shelly2rgbw_color") {
      if (s.Readings.rgb) {
        mappings.RGB = {
          reading: 'rgb',
          cmd: 'rgb'
        };
        mappings.RGB.reading2homekit = function (mapping, orig) {
          return parseInt('0x' + orig);
        };
        mappings.RGB.homekit2reading = function (mapping, orig) {
          return ("000000" + orig.toString(16)).substr(-6);
        };
      }
    } else {
      if (s.PossibleSets.match(/(^| )on\b/))
        mappings.On = {
          reading: 'state',
          valueOff: 'off',
          cmdOn: 'on',
          cmdOff: 'off'
        };
      if (s.PossibleSets.match(/(^| )brightness\b/))
        mappings.Brightness = {
          reading: 'brightness',
          cmd: 'brightness',
          max: 255,
          maxValue: 100
        };
      //mappings.ColorMode = {reading: 'colormode', valueCt: 'ct'};
      if (s.PossibleSets.match(/(^| )color_temp\b/)) {
        mappings.ColorTemperature = {
          reading: 'color_temp',
          cmd: 'color_temp'
        };
        mappings.ColorTemperature.reading2homekit = function (mapping, orig) {
          var match;
          if (match = orig.match(/^(\d+) \((\d+)K\)/)) {
            return parseInt(match[2]);
          }
          return 0;
        };
        mappings.ColorTemperature.homekit2reading = function (mapping, orig) {
          //kelvin to mired
          return parseInt(1000000 / orig);
        };
      }
      if (s.PossibleSets.match(/(^| )color\b/)) {
        mappings.RGB = {
          reading: 'color',
          cmd: 'color'
        };
        mappings.RGB.reading2homekit = function (mapping, orig) {
          return parseInt('0x' + orig);
        };
        mappings.RGB.homekit2reading = function (mapping, orig) {
          return ("000000" + orig.toString(16)).substr(-6);
        };
      }
      if (mappings.Brightness) {
        if (!service_name) service_name = 'light';
      }
    }
  } else if (s.Internals.TYPE === 'HUEDevice') {
    if (s.Internals.type === 'LightGroup') {
      mappings.RGB = {
        commandOnlyColorSetting: true,
        cmd: 'rgb'
      };
      mappings.RGB.homekit2reading = function (mapping, orig) {
        return ("000000" + orig.toString(16)).substr(-6);
      };
      if (s.Readings.rgb) {
        mappings.RGB.reading = "rgb";
        mappings.RGB.commandOnlyColorSetting = false;
        mappings.RGB.reading2homekit = function (mapping, orig) {
          return parseInt('0x' + orig);
        };
      }
      mappings.ColorTemperature = {
        cmd: 'ct'
      };
      mappings.ColorTemperature.homekit2reading = function (mapping, orig) {
        //kelvin to mired
        return parseInt(1000000 / orig);
      };
      if (s.Readings.ct) {
        mappings.ColorTemperature.reading = "ct";
        mappings.ColorTemperature.reading2homekit = function (mapping, orig) {
          var match;
          if (match = orig.match(/^(\d+) \((\d+)K\)/)) {
            return parseInt(match[2]);
          }
          return 0;
        };
      }
      if (s.Readings.colormode) {
        mappings.ColorMode = {
          reading: 'colormode',
          valueCt: 'ct'
        };
      }
    }
    if (s.Attributes.subType === "ctdimmer") {
      if (!service_name) service_name = 'light';
      //Hue CT mode
      mappings.ColorMode = {
        reading: 'colormode',
        valueCt: 'ct'
      };

      mappings.ColorTemperature = {
        reading: 'ct',
        cmd: 'ct'
      };
      mappings.ColorTemperature.reading2homekit = function (mapping, orig) {
        var match;
        if (match = orig.match(/^(\d+) \((\d+)K\)/)) {
          return parseInt(match[2]);
        }
        return 0;
      };
      mappings.ColorTemperature.homekit2reading = function (mapping, orig) {
        //kelvin to mired
        return parseInt(1000000 / orig);
      };

      mappings.Errors.deviceOffline = {
        reading: 'reachable',
        valueError: '0'
      };
    }
    if (s.Internals.modelid === 'lumi.sensor_magnet.aq2') {
      if (!service_name) service_name = 'door';
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^closed/:CLOSED', '/.*/:OPEN']
      };
    }
    if (s.Internals.modelid === "SPZB0001") {
      if (!service_name) service_name = 'thermostat';
      mappings.TargetTemperature = {
        reading: 'heatsetpoint',
        cmd: 'heatsetpoint'
      };
    }
  } else if (s.Internals.TYPE === 'EnOcean') {
    if (s.Attributes.subType === 'contact') {
      if (!service_name) service_name = 'door';
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^closed/:CLOSED', '/.*/:OPEN']
      };
    } else if (s.Attributes.subType === 'windowHandle') {
      if (!service_name) service_name = 'window';
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^closed/:CLOSED', '/.*/:OPEN']
      };
    }
  } else if (s.Internals.TYPE === 'STV') {
    mappings.On = {
      reading: 'state',
      valueOff: 'disconnected',
      cmdOn: 'POWERON',
      cmdOff: 'POWEROFF'
    };
  } else if (s.Internals.TYPE === 'SamsungAV') {
    if (!service_name) service_name = 'tv';

    mappings.SimpleInputSelector = {
      voicecmds: {
        "HDMI 1": "hdmi1",
        "HDMI 2": "hdmi2",
        "TV": "tv"
      }
    };
    mappings.ChannelRelativeChannel = {
      "params": {
        "relativeChannelChange": {
          "cmdUp": "channelUp",
          "cmdDown": "channelDown"
        }
      }
    };
    mappings.MediaPlaybackState = {
      reading: "state",
      values: ["on:PLAYING", "/.*/:STOPPED"]
    };
    mappings.MediaActivityState = {
      reading: "state",
      values: ["on:ACTIVE", "/.*/:STANDBY"]
    };
    if (s.Internals.Port === '55000') {
      mappings.On = {
        reading: 'state',
        valueOff: 'absent',
        cmdOn: 'poweron',
        cmdOff: 'poweroff'
      };
    } else {
      mappings.On = {
        reading: 'state',
        valueOff: 'absent',
        cmdOn: 'power',
        cmdOff: 'power'
      };
    }
    mappings.mediaPause = {
      cmd: 'pause'
    };
    mappings.mediaResume = {
      cmd: 'play'
    };
    mappings.mediaStop = {
      cmd: 'stop'
    };
    mappings.Volume = {
      cmdUp: "volumeUp",
      cmdDown: "volumeDown",
      levelStepSize: 3
    };
    mappings.Mute = {
      cmd: "mute"
    };
  } else if (s.Internals.TYPE === 'VIERA') {
    if (!service_name) service_name = 'tv';

    mappings.SimpleInputSelector = {
      cmd: "input",
      voicecmds: {
        "HDMI 1": "HDMI_1",
        "HDMI 2": "HDMI_2",
        "HDMI 3": "HDMI_3",
        "HDMI 4": "HDMI_4",
        "SD Card, SD Karte": "SD_card",
        "TV": "TV"
      }
    };
    mappings.On = {
      reading: 'state',
      valueOff: 'off',
      cmdOn: 'on_off',
      cmdOff: 'on_off'
    };
    mappings.mediaPause = {
      cmd: 'remoteControl pause'
    };
    mappings.mediaResume = {
      cmd: 'remoteControl play'
    };
    mappings.mediaStop = {
      cmd: 'remoteControl stop'
    };
    mappings.Volume = {
      reading: "volume",
      cmd: "volume",
      levelStepSize: 3
    };
    mappings.Mute = {
      reading: "mute",
      valueOff: "off",
      cmdOn: "mute on",
      cmdOff: "mute off"
    };
  } else if (s.Internals.TYPE === "XiaomiSmartHome_Device") {
    if (s.Internals.MODEL === "sensor_wleak.aq1") {
      if (!service_name) service_name = 'sensor';
      mappings.WaterLeak = {
        reading: "state",
        values: ["leak:leak", "no_leak:no leak", "/.*/:unknown"]
      };
      mappings.Exceptions.waterLeakDetected = {
        reading: 'state',
        values: ['leak:EXCEPTION', '/.*/:OK'],
        onlyLinkedInfo: false
      };
    } else if (s.Internals.MODEL == 'sensor_magnet.aq2') {
      if (!service_name) service_name = 'door';
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^close/:CLOSED', '/.*/:OPEN']
      };
    } else if (s.Internals.MODEL === 'weather.v1' || s.Internals.MODEL === 'sensor_ht') {
      if (!service_name) service_name = 'sensor';
      if (mappings.CurrentTemperature) {
        delete mappings.CurrentTemperature;
      }
      mappings.TemperatureControlAmbientCelsius = { "reading": "temperature" };
      mappings.CurrentRelativeHumidity = { "reading": "humidity" };
    }
  } else if (s.Internals.TYPE === "BDKM") {
    if (!service_name) service_name = 'thermostat';
    mappings.TargetTemperature = {
      reading: 'RoomTemporaryDesiredTemp',
      cmd: 'RoomTemporaryDesiredTemp'
    };
    mappings.TemperatureControlAmbientCelsius = { "reading": "WaterTemp" };
    mappings.Toggles = [{
      reading: 'Einmalladung', valueOn: 'start', cmdOn: 'Einmalladung start', cmdOff: 'Einmalladung stop',
      toggle_attributes: {
        name: 'Einmalladung',
        name_values: [
          {
            name_synonym: ['Einmalladung'],
            lang: 'de'
          }
        ]
      }
    }];
  } else if (s.Internals.TYPE === "EleroDrive") {
    mappings.OpenClose = {
      reading: 'state',
      values: ['/^top_position/:OPEN', '/.*/:OPEN'],
      cmdOpen: 'moveUp',
      cmdClose: 'moveDown'
    };
  } else if (s.Internals.TYPE === "Shelly") {
    if (s.Attributes.model === "shellydimmer") {
      if (!service_name) service_name = "light";
      mappings.On = {
        reading: 'state',
        valueOff: 'off',
        cmdOn: 'on',
        cmdOff: 'off'
      };
      mappings.Brightness = {
        reading: 'pct',
        cmd: 'pct'
      };
    }
    if (containsCommand(uid, s, "x_update")) {
      mappings.SoftwareUpdate = {
        cmd: 'x_update'
      };
    }
  }

  //TRAITS BASED ON SERVICE_NAME / POSSIBLE COMMANDS
  if (service_name === 'tv' || service_name === 'settop' || service_name === 'remotecontrol') {
    if (containsCommand(uid, s, 'play')) {
      mappings.mediaResume = {
        cmd: 'play'
      };
    }
    if (containsCommand(uid, s, 'stop')) {
      mappings.mediaStop = {
        cmd: 'stop'
      };
    }
    if (containsCommand(uid, s, 'next')) {
      mappings.mediaNext = {
        cmd: 'next'
      };
    }
    if (containsCommand(uid, s, 'prev')) {
      mappings.mediaPrevious = {
        cmd: 'prev'
      };
    }
    if (containsCommand(uid, s, 'pause')) {
      mappings.mediaPause = {
        cmd: 'pause'
      };
    }
  } else if (service_name === 'securitysystem') {
    mappings.ArmDisarm = {
      reading: 'state',
      values: ['/on/:ARMED', '/.*/:DISARMED'],
      cmdArm: 'on',
      cmdDisarm: 'off',
      exitAllowance: 60,
      cancelArm: 'off'
    };
    delete mappings.On;
  } else if (service_name === 'window' || service_name === 'door') {
    if (!mappings.OpenClose && s.Internals.TYPE === 'HM485' && s.Attributes.subType === 'sensor') {
      delete mappings.On;
      mappings.OpenClose = {
        reading: 'sensor',
        values: ['/^open/:OPEN', '/.*/:CLOSED']
      };
    } else if (!mappings.OpenClose && s.Internals.TYPE === 'HM485' && s.Attributes.subType === 'digital_input') {
      delete mappings.On;
      mappings.OpenClose = {
        reading: 'state',
        values: ['/^on/:OPEN', '/.*/:CLOSED']
      };
    }
  } else if (service_name === 'sensor') {
    if (mappings.CurrentTemperature && mappings.CurrentTemperature.reading) {
      mappings.TemperatureControlAmbientCelsius = {
        reading: mappings.CurrentTemperature.reading
      };
      delete mappings.CurrentTemperature;
    }
  }

  //homebridgeMapping Attribute
  try {
    var mappingsFromHb = fromHomebridgeMapping(uid, mappings, s.Attributes.homebridgeMapping);
    if (mappingsFromHb !== undefined)
      mappings = mappingsFromHb;
  } catch (e) {
    uiderror(uid, 'homebridgeMapping error for ' + s.Internals.NAME + ', please delete homebridgeMapping and try again');
  }

  if (mappings.OpenClose && mappings.OpenClose.values) {
    var valuesData = [];
    for (var v of mappings.OpenClose.values) {
      valuesData.push(v.replace(":OPEN", ":EXCEPTION").replace(":CLOSED", ":OK"));
    }
    mappings.Exceptions.deviceOpen = {
      reading: mappings.OpenClose.reading,
      values: valuesData,
      onlyLinkedInfo: true
    };
  }

  //SIMPLE MAPPINGS
  // - SimpleInputSelector
  if (mappings.SimpleInputSelector) {
    mappings.InputSelector = mappings.SimpleInputSelector;
    mappings.InputSelector.availableInputs = [];

    for (var i in mappings.SimpleInputSelector.voicecmds) {
      var mInput = {};
      mInput.key = mappings.SimpleInputSelector.voicecmds[i];
      mInput.names = [];
      mInput.names.push({
        name_synonym: i.split(','),
        lang: mappings.SimpleInputSelector.lang || "de"
      });
      mappings.InputSelector.availableInputs.push(mInput);
    }

    delete mappings.InputSelector.voicecmds;
    delete mappings.SimpleInputSelector;
  }

  // - SimpleModes
  if (mappings.SimpleModes) {
    mappings.Modes = [];

    if (!Array.isArray(mappings.SimpleModes))
      mappings.SimpleModes = [mappings.SimpleModes];

    for (var m in mappings.SimpleModes) {
      var language = 'de';
      var mode = {
        cmds: [],
        mode_attributes: {
          settings: []
        }
      };
      for (var synName in mappings.SimpleModes[m]) {
        if (synName == "reading") {
          mode.reading = mappings.SimpleModes[m].reading;
        } else if (synName == "lang") {
          language = mappings.SimpleModes[m].lang;
        } else if (synName == "name") {
          mode.mode_attributes.name = mappings.SimpleModes[m].name;
          mode.mode_attributes.name_values = [{ name_synonym: [mappings.SimpleModes[m].name], lang: language }];
        } else {
          mode.mode_attributes.settings.push({
            setting_name: synName.split(',')[0],
            setting_values: [{
              setting_synonym: synName.split(','),
              lang: language
            }]
          });
          mode.cmds.push(synName.split(',')[0] + ':' + mappings.SimpleModes[m][synName]);
        }
      }
      mappings.Modes.push(mode);
    }
    delete mappings.SimpleModes;
  }

  // - SimpleChannel
  if (mappings.SimpleChannel) {
    mappings.Channel = {};
    mappings.Channel.availableChannels = [];
    mappings.Channel.cmds = [];
    for (var chDef in mappings.SimpleChannel) {
      var gChDef = { "key": chDef.split(",")[0], "names": chDef.split(",")};
      mappings.Channel.availableChannels.push(gChDef);
      mappings.Channel.cmds.push(chDef.split(",")[0] + ":" + mappings.SimpleChannel[chDef]);
    }
    delete mappings.SimpleChannel;
  }

  // - SimpleToggles
  if (mappings.SimpleToggles) {
    mappings.Toggles = [];

    if (!Array.isArray(mappings.SimpleToggles))
      mappings.SimpleToggles = [mappings.SimpleToggles];

    for (var t in mappings.SimpleToggles) {
      var language = mappings.SimpleToggles[t].lang || 'de';
      var toggle = mappings.SimpleToggles[t];
      toggle.toggle_attributes = {};
      toggle.toggle_attributes.name = mappings.SimpleToggles[t].voicecmd.split(',')[0];
      toggle.toggle_attributes.name_values = [{ name_synonym: [], lang: language }];
      for (var v of mappings.SimpleToggles[t].voicecmd.split(',')) {
        toggle.toggle_attributes.name_values[0].name_synonym.push(v);
      }
      delete toggle.voicecmd;
      delete toggle.lang;
      mappings.Toggles.push(toggle);
    }
    delete mappings.SimpleToggles;
  }

  // - SimpleDispense
  if (mappings.SimpleDispense) {
    mappings.Dispense = JSON.parse(JSON.stringify(mappings.SimpleDispense));
    mappings.Dispense.supportedDispenseItems = [];
    mappings.Dispense.supportedDispensePresets = [];

    for (var sdi of mappings.SimpleDispense.supportedDispenseItems) {
      var supportedDispenseItem = {
        "item_name": sdi["itemName"][0],
        "item_name_synonyms": [{
          "lang": "de",
          "synonyms": sdi["itemName"]
        }],
        "supported_units": sdi["units"],
        "default_portion": {
          "amount": sdi["defaultAmount"],
          "unit": sdi["defaultUnit"]
        }
      };
      mappings.Dispense.supportedDispenseItems.push(supportedDispenseItem);
    }
    for (var sdp of mappings.SimpleDispense.supportedDispensePresets) {
      var supportedDispensePreset = {
        "preset_name": sdp.split(",")[0],
        "preset_name_synonyms": [{
          "lang": "de",
          "synonyms": sdp.split(",")
        }]
      };
      mappings.Dispense.supportedDispensePresets.push(supportedDispensePreset);
    }

    delete mappings.SimpleDispense;
  }

  // - SimpleCook
  if (mappings.SimpleCook) {
    mappings.Cook = JSON.parse(JSON.stringify(mappings.SimpleCook));
    mappings.Cook.supportedCookingModes = mappings.SimpleCook.supportedCookingModes;
    mappings.Cook.foodPresets = [];

    for (var fp of mappings.SimpleCook.foodPresets) {
      var tmp_fp = {};
      tmp_fp.food_preset_name = fp["food_preset_name"][0];
      tmp_fp.supported_units = fp["supported_units"];
      tmp_fp.food_synonyms = [{
        "lang": "de",
        "synonym": fp["food_preset_name"]
      }];
      if (mappings.SimpleCookSynonyms && mappings.SimpleCookSynonyms[tmp_fp.food_preset_name]) {
        tmp_fp.food_synonyms[0].synonym.push(...mappings.SimpleCookSynonyms[tmp_fp.food_preset_name]);
      }
      mappings.Cook.foodPresets.push(tmp_fp);
    }

    if (mappings.SimpleCookSynonyms) {
      delete mappings.SimpleCookSynonyms;
    }
    delete mappings.SimpleCook;
  }

  uidlog(uid, 'mappings for ' + s.Internals.NAME + ': ' + JSON.stringify(mappings));

  if (service_name !== undefined) {
    uidlog(uid, s.Internals.NAME + ' is ' + service_name);
  } else if (!mappings) {
    uiderror(uid, s.Internals.NAME + ': no service type detected');
    return;
  }

  if (Object.keys(mappings.Exceptions).length === 0) {
    delete mappings.Exceptions;
  }

  if (Object.keys(mappings.Errors).length === 0) {
    delete mappings.Errors;
  }

  if (Object.keys(mappings).length === 0) {
    uiderror(uid, 'No mappings (e.g. on/off) found for ' + s.Internals.NAME);
    return undefined;
  }

  // device info
  var device = s.Internals.NAME;

  // prepare mapping internals
  var virtualDevicesJSON = {};
  for (characteristic_type in mappings) {
    let mappingChar = mappings[characteristic_type];
    //mappingChar = Modes array

    if (characteristic_type === 'LinkedDevices')
      continue;

    if (characteristic_type === 'Exceptions' || characteristic_type === 'Errors') {
      for (var exception_type in mappingChar) {
        prepare(uid, characteristic_type, s, device, mappingChar[exception_type], usedDeviceReadings);
      }
      continue;
    }

    if (!Array.isArray(mappingChar))
      mappingChar = [mappingChar];

    for (var i = 0; i < mappingChar.length; i++) {
      mapping = mappingChar[i];
      //mapping = Modes[0]

      prepare(uid, characteristic_type, s, device, mapping, usedDeviceReadings);

      if (mapping.params) {
        for (var param in mapping.params) {
          prepare(uid, characteristic_type, s, device, mapping.params[param], usedDeviceReadings);
        }
      }

      if (mapping.virtualdevice) {
        var virtualDevName = s.Internals.NAME.replace(/\.|\#|\[|\]|\$/g, '_') + "_" + mapping.virtualdevice.replace(/\.|\#|\[|\]|\$/g, '_');
        if (!virtualDevicesJSON[virtualDevName]) {
          virtualDevicesJSON[virtualDevName] = {};
          virtualDevicesJSON[virtualDevName]['XXXDEVICEDEFXXX'] = {};
        }
        // refer from virtual device to main device
        mapping.device = s.Internals.NAME;
        var vMapping = {};
        vMapping[characteristic_type] = mapping;
        var virtualDev = createDeviceJson(s, vMapping, connection, uid, service_name, { virtualname: virtualDevName, alias: mapping.virtualdevice });
        virtualDevicesJSON[virtualDevName]['XXXDEVICEDEFXXX'] = merge(virtualDevicesJSON[virtualDevName]['XXXDEVICEDEFXXX'], virtualDev);
        if (Array.isArray(mappings[characteristic_type])) {
          mappings[characteristic_type].splice(i, 1);
          i--;
          if (mappings[characteristic_type].length == 0)
            delete mappings[characteristic_type];
        } else {
          delete mappings[characteristic_type];
        }
      }
    }
  }

  if (Object.keys(mappings).length === 0) {
    return {
      device: undefined,
      virtualdevices: virtualDevicesJSON
    }
  }

  var deviceAttributes = createDeviceJson(s, mappings, connection, uid, service_name);

  //await setDeviceAttributeJSON(uid, device, deviceAttributes);
  var realDBUpdateJSON = {};
  realDBUpdateJSON['XXXDEVICEDEFXXX'] = deviceAttributes;
  return {
    device: realDBUpdateJSON,
    virtualdevices: virtualDevicesJSON,
  };
}

function createDeviceJson(s, mappings, connection, uid, service_name, virtual) {
  var deviceAttributes = {
    'name': virtual ? virtual.virtualname : s.Internals.NAME,
    // get ghomeName using this priority: gassistantName -> assistantName -> alias -> NAME
    'ghomeName': virtual ? virtual.alias : s.Attributes.gassistantName ? s.Attributes.gassistantName : s.Attributes.assistantName ? s.Attributes.assistantName : s.Attributes.alias ? s.Attributes.alias : s.Internals.NAME,
    'alias': s.Attributes.alias ? s.Attributes.alias : '',
    'device': virtual ? virtual.virtualname : s.Internals.NAME,
    'type': s.Internals.TYPE,
    'model': s.Readings.model ? s.Readings.model.Value : (s.Attributes.model ? s.Attributes.model :
      (s.Internals.model ? s.Internals.model : '<unknown>')),
    'PossibleSets': s.PossibleSets,
    'room': s.Attributes.room ? s.Attributes.room : '',
    'ghomeRoom': s.Attributes.realRoom ? s.Attributes.realRoom : '',
    'uuid_base': virtual ? virtual.virtualname : s.Internals.NAME,
    'mappings': mappings,
    'connection': connection
  };
  if (!s.Attributes.realRoom) {
    deviceRooms[uid][deviceAttributes.name] = deviceAttributes.room;
  }
  if (service_name)
    deviceAttributes.service_name = service_name;
  return deviceAttributes;
}

function getCommandParams(uid, device, cmd) {
  var re = new RegExp("(^| )" + cmd + ":(\\S+)\\b", 'g');
  var m = re.exec(device.PossibleSets);
  if (m && m.length > 1) {
    let params = m[2].split(",");
    return params;
  }
  return [];
}

function containsCommand(uid, device, cmd) {
  var re = new RegExp("(^| )" + cmd + "\\b", 'g');
  if (device.PossibleSets.match(re)) {
    return true;
  }
  return false;
}

// async function setDeviceRoom(uid, device, room) {
//   await utils.getRealDB().ref('/users/' + uid + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/XXXDEVICEDEFXXX').update({ghomeRoom: room});
// };

// async function setDeviceAttributeJSON(uid, device, json) {
//   await utils.getRealDB().ref('/users/' + uid + '/devices/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/XXXDEVICEDEFXXX').set(json);
// };

function formatOfName(characteristic_type) {
  if (characteristic_type == 'On')
    return 'bool';
  else if (characteristic_type == 'Actuation')
    return 'int';
  else if (characteristic_type == 'Volume')
    return 'int';
  else if (characteristic_type == 'Mute')
    return 'bool';
  else if (characteristic_type == 'GuestNetwork')
    return 'bool';
  else if (characteristic_type == 'NetworkEnabled')
    return 'bool';
  else if (characteristic_type == 'ConnectedDevices')
    return 'int';
  else if (characteristic_type == 'NetworkUsageMB')
    return 'float';
  else if (characteristic_type == 'NetworkUsageLimitMB')
    return 'float';

  return undefined;
}

function fromHomebridgeMapping(uid, mappings, homebridgeMapping) {
  if (!homebridgeMapping)
    return;

  uidlog(uid, 'homebridgeMapping: ' + homebridgeMapping);

  if (homebridgeMapping.match(/^{.*}$/s)) {
    try {
      try {
        homebridgeMapping = JSON.parse(homebridgeMapping);
        uidlog(uid, "homebridgeMapping JSON: ok");
      } catch (err) {
        homebridgeMapping = homebridgeMapping.replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2": ');
        uidlog(uid, 'homebridgeMapping formatted: ' + homebridgeMapping);
        homebridgeMapping = JSON.parse(homebridgeMapping);
      }

      if (homebridgeMapping.clear)
        mappings = {};

      for (let characteristic in homebridgeMapping) {
        if (!mappings[characteristic])
          mappings[characteristic] = {};

        if (Array.isArray(homebridgeMapping[characteristic])) {
          mappings[characteristic] = homebridgeMapping[characteristic];
        } else {
          for (let attrname in homebridgeMapping[characteristic])
            mappings[characteristic][attrname] = homebridgeMapping[characteristic][attrname];
        }
      }

      return mappings;
    } catch (err) {
      uiderror(uid, 'JSON error in homebridgeMapping: ' + JSON.stringify(homebridgeMapping) + " => " + err);
      return undefined;
    }
  }

  var seen = {};
  for (var mapping of homebridgeMapping.split(/\n/)) {
    if (!mapping)
      continue;

    if (mapping.match(/^#/))
      continue;

    if (mapping == 'clear') {
      mappings = {};
      continue;
    }

    var match = mapping.match(/(^.*?)(:|=)(.*)/);
    if (match === null || match.length < 4 || !match[3]) {
      uiderror(uid, '  wrong syntax: ' + mapping);
      continue;
    }

    var characteristic = match[1];
    var params = match[3];

    var mapping;
    if (!seen[characteristic] && mappings[characteristic] !== undefined)
      mapping = mappings[characteristic];
    else {
      mapping = {};
      if (mappings[characteristic]) {
        if (mappings[characteristic].length == undefined)
          mappings[characteristic] = [this.mappings[characteristic]];
        mappings[characteristic].push(mapping);
      } else
        mappings[characteristic] = mapping;
    }
    seen[characteristic] = true;

    if (params.match(/^{.*}$/)) {
      try {
        mappings[characteristic] = JSON.parse(params);
      } catch (err) {
        uiderror(uid, '  fromHomebridgeMapping JSON.parse (' + params + '): ' + err, err);
        return;
      }
      continue;
    }

    for (var param of params.split(',')) {
      if (param == 'clear') {
        mapping = {};
        delete mappings[characteristic];
        continue;
      } else if (!mappings[characteristic])
        mappings[characteristic] = mapping

      var p = param.split('=');
      if (p.length == 2)
        if (p[0] == 'values')
          mapping[p[0]] = p[1].split(';');
        else if (p[0] == 'valid')
          mapping[p[0]] = p[1].split(';');
        else if (p[0] == 'cmds')
          mapping[p[0]] = p[1].split(';');
        else if (p[0] == 'delay') {
          mapping[p[0]] = parseInt(p[1]);
          if (isNaN(mapping[p[0]])) mapping[p[0]] = true;
        } else if (p[0] === 'minValue' || p[0] === 'maxValue' || p[0] === 'minStep' ||
          p[0] === 'min' || p[0] === 'max' ||
          p[0] === 'default') {
          mapping[p[0]] = parseFloat(p[1]);
          if (isNaN(mapping[p[0]]))
            mapping[p[0]] = p[1];
        } else
          mapping[p[0]] = p[1].replace(/\+/g, ' ');

      else if (p.length == 1) {
        if (mappings[param] !== undefined) {
          try {
            mapping = Object.assign({}, mappings[param]);
          } catch (err) {
            uidlog(uid, mappings[param]);
            for (var x in mappings[param]) {
              mapping[x] = mappings[param][x]
            }
          }
          mappings[characteristic] = mapping;

        } else if (p === 'invert') {
          mapping[p] = 1;

        } else {
          var p = param.split(':');

          var reading = p[p.length - 1];
          var device = p.length > 1 ? p[p.length - 2] : undefined;
          var cmd = p.length > 2 ? p[p.length - 3] : undefined;

          if (reading)
            mapping.reading = reading;

          if (device)
            mapping.device = device;

          if (cmd)
            mapping.cmd = cmd;
        }

      } else {
        uiderror(uid, '  wrong syntax: ' + param);

      }
    }
  }
}

function prepare(uid, characteristic_type, s, device, mapping, usedDeviceReadings) {
  mapping.characteristic_type = characteristic_type;

  var devicetmp = device;
  if (!mapping.device)
    mapping.device = devicetmp;
  else
    devicetmp = mapping.device;

  //if (mapping.reading === undefined && mapping.default === undefined)
  //  mapping.reading = 'state';

  if (!mapping.format)
    mapping.format = formatOfName(characteristic_type);

  if (mapping.format === undefined)
    delete mapping.format;

  //create reading values in realtime database
  if (mapping.reading !== undefined) {
    if (!Array.isArray(mapping.reading)) {
      mapping.reading = [mapping.reading];
    }
    for (var r of mapping.reading) {
      var orig = undefined;
      if (s.Readings[r] && s.Readings[r].Value)
        orig = s.Readings[r].Value;

      if (orig === undefined && devicetmp == device && mapping.default !== undefined)
        continue;

      if (orig === undefined) {
        continue;
      }

      if (!usedDeviceReadings[mapping.device]) {
        usedDeviceReadings[mapping.device] = {};
      }

      //define compare functions which are used for report state
      var compareFunction;
      if (characteristic_type === 'RGB' ||
        characteristic_type === 'Hue' ||
        characteristic_type === 'Saturation' ||
        characteristic_type === 'Brightness') {
        compareFunction = function (oldValue, oldTimestamp, newValue, cancelOldTimeout, oldDevTimestamp, cancelOldDevTimeout, reportStateFunction, device) {
          //check if old != new
          if (oldValue !== newValue) {
            if ((oldDevTimestamp + 5000) > Date.now()) {
              if (cancelOldDevTimeout) clearTimeout(cancelOldDevTimeout);
            }
            //check how old old is
            if ((oldTimestamp + 10000) > Date.now()) {
              //oldTimestamp is younger then 10s
              if (cancelOldTimeout) clearTimeout(cancelOldTimeout);
              return setTimeout(reportStateFunction.bind(null, device), 10000);
            } else {
              //oldTimestamp is older then 10s
              return setTimeout(reportStateFunction.bind(null, device), 10000);
            }
          }
          return undefined;
        };
      } else if (characteristic_type === 'CurrentTemperature') {
        compareFunction = function (oldValue, oldTimestamp, newValue, cancelOldTimeout, oldDevTimestamp, cancelOldDevTimeout, reportStateFunction, device) {
          //check if old != new
          if (Math.round(oldValue) !== Math.round(newValue)) {
            if ((oldDevTimestamp + 5000) > Date.now()) {
              if (cancelOldDevTimeout) clearTimeout(cancelOldDevTimeout);
            }
            //check how old old is
            if ((oldTimestamp + 60000) > Date.now()) {
              //oldTimestamp is younger then 60s
              if (cancelOldTimeout) clearTimeout(cancelOldTimeout);
              return setTimeout(reportStateFunction.bind(null, device), 60000);
            } else {
              //oldTimestamp is older then 60s
              return setTimeout(reportStateFunction.bind(null, device), 60000);
            }
          }
          return undefined;
        };
      } else if (characteristic_type === 'CurrentRelativeHumidity') {
        compareFunction = function (oldValue, oldTimestamp, newValue, cancelOldTimeout, oldDevTimestamp, cancelOldDevTimeout, reportStateFunction, device) {
          //check if old != new
          if (Math.round(oldValue) !== Math.round(newValue)) {
            if ((oldDevTimestamp + 5000) > Date.now()) {
              if (cancelOldDevTimeout) clearTimeout(cancelOldDevTimeout);
            }
            //check how old old is
            if ((oldTimestamp + 60000) > Date.now()) {
              //oldTimestamp is younger then 60s
              if (cancelOldTimeout) clearTimeout(cancelOldTimeout);
              return setTimeout(reportStateFunction.bind(null, device), 60000);
            } else {
              //oldTimestamp is older then 60s
              return setTimeout(reportStateFunction.bind(null, device), 60000);
            }
          }
          return undefined;
        };
      } else {
        compareFunction = function (oldValue, oldTimestamp, newValue, cancelOldTimeout, oldDevTimestamp, cancelOldDevTimeout, reportStateFunction, device) {
          if (oldValue !== newValue) {
            if ((oldDevTimestamp + 900) > Date.now()) {
              if (cancelOldDevTimeout) clearTimeout(cancelOldDevTimeout);
            }
            if (cancelOldTimeout) clearTimeout(cancelOldTimeout);
            return setTimeout(reportStateFunction.bind(null, device), 1000);
          }
          return undefined;
        };
      }
      //BACKWARD COMPATIBILITY: delete format
      uidlog(uid, ' use reading: ' + r);
      usedDeviceReadings[mapping.device][r] = {
        'format': 'standard',
        'compareFunction': compareFunction.toString()
      };
    }
  }

  if (typeof mapping.values === 'object') {
    mapping.value2homekit = {};
    mapping.value2homekit_re = [];
    if (mapping.homekit2name === undefined) mapping.homekit2name = {};
    for (var entry of mapping.values) {
      var match = entry.match('^((.*?)=)?([^:]*)(:(.*))?$');
      if (!match) {
        uiderror(uid, 'values: format wrong for ' + entry);
        continue;
      }

      var reading = match[2];
      var from = match[3];
      var to = match[5] === undefined ? entry : match[5];
      to = to.replace(/\+/g, ' ');

      var match;
      if (match = from.match('^\/(.*)\/$')) {
        if (reading)
          mapping.value2homekit_re.push({
            'reading': reading,
            re: match[1],
            to: to
          });
        else
          mapping.value2homekit_re.push({
            re: match[1],
            to: to
          });
        delete mapping.value2homekit;
      } else {
        from = from.replace(/\+/g, ' ');
        mapping.value2homekit[from] = to;
      }
    }
    if (mapping.value2homekit_re &&
      mapping.value2homekit_re.length) uidlog(uid, 'value2homekit_re: ' + JSON.stringify(mapping.value2homekit_re));
    if (mapping.value2homekit &&
      Object.keys(mapping.value2homekit).length) uidlog(uid, 'value2homekit: ' + JSON.stringify(mapping.value2homekit));
    if (mapping.homekit2name) {
      if (Object.keys(mapping.homekit2name).length)
        uidlog(uid, 'homekit2name: ' + JSON.stringify(mapping.homekit2name));
      else
        delete mapping.homekit2name;
    }
  }

  if (typeof mapping.cmds === 'object') {
    mapping.homekit2cmd = {};
    mapping.homekit2cmd_re = [];
    for (var entry of mapping.cmds) {
      var match = entry.match('^([^:]*)(:(.*))?$');
      if (!match) {
        uiderror(uid, 'cmds: format wrong for ' + entry);
        continue;
      }

      var from = match[1];
      var to = match[2] !== undefined ? match[3] : match[1];
      to = to.replace(/\+/g, ' ');

      if (match = from.match('^/(.*)/$')) {
        mapping.homekit2cmd_re.push({
          re: match[1],
          to: to
        });
      } else {
        from = from.replace(/\+/g, ' ');

        mapping.homekit2cmd[from] = to;
      }
    }
    if (mapping.homekit2cmd_re &&
      mapping.homekit2cmd_re.length) uidlog(uid, 'homekit2cmd_re: ' + JSON.stringify(mapping.homekit2cmd_re));
    if (mapping.homekit2cmd &&
      Object.keys(mapping.homekit2cmd).length) uidlog(uid, 'homekit2cmd: ' + JSON.stringify(mapping.homekit2cmd));
  }

  if (mapping.reading2homekit !== undefined && typeof mapping.reading2homekit !== 'function') {
    if (mapping.reading2homekit.match(/^{.*}$/)) {
      try {
        mapping.reading2homekit = new Function('mapping', 'orig', mapping.reading2homekit).bind(null, mapping);
      } catch (err) {
        uiderror(uid, '  reading2homekit: ' + err);
        //delete mapping.reading2homekit;
      }
      //FIXME GOOGLE jsFunctions deactivated
      //} else if (typeof this.jsFunctions === 'object') {
      //    if (typeof this.jsFunctions[mapping.reading2homekit] === 'function')
      //        mapping.reading2homekit = this.jsFunctions[mapping.reading2homekit].bind(null, mapping);
      //    else
      //        uiderror(uid, '  reading2homekit: no function named ' + mapping.reading2homekit + ' in ' + JSON.stringify(this.jsFunctions));
    }

    if (mapping.reading2homekit !== undefined && typeof mapping.reading2homekit !== 'function') {
      uiderror(uid, '  reading2homekit disabled.');
      delete mapping.reading2homekit;
    }
  }

  if (mapping.homekit2reading !== undefined && typeof mapping.homekit2reading !== 'function') {
    if (mapping.homekit2reading.match(/^{.*}$/)) {
      try {
        mapping.homekit2reading = new Function('mapping', 'orig', mapping.homekit2reading).bind(null, mapping);
      } catch (err) {
        uiderror(uid, '  homekit2reading: ' + err);
        //delete mapping.homekit2reading;
      }
      //} else if (typeof this.jsFunctions === 'object') {
      //    if (typeof this.jsFunctions[mapping.homekit2reading] === 'function')
      //        mapping.homekit2reading = this.jsFunctions[mapping.homekit2reading].bind(null, mapping);
      //    else
      //        uiderror(uid, '  homekit2reading: no function named ' + mapping.homekit2reading + ' in ' + JSON.stringify(this.jsFunctions));
    }

    if (mapping.homekit2reading !== undefined && typeof mapping.homekit2reading !== 'function') {
      uiderror(uid, '  homekit2reading disabled.');
      delete mapping.homekit2reading;
    }
  }

  if (typeof mapping.reading2homekit === 'function')
    mapping.reading2homekit = mapping.reading2homekit.toString();

  if (typeof mapping.homekit2reading === 'function')
    mapping.homekit2reading = mapping.homekit2reading.toString();

  if (mapping.cmdFunction)
    mapping.cmdFunction = mapping.cmdFunction.toString();
};


async function generateRoomHint(uid, realDBUpdateJSON) {
  //try to get the real room if no realRoom is defined
  let roomCheck = {};
  //deviceRooms
  // [devicename] = room1,room2,room3
  // [devicename2] = room2,room4
  Object.keys(deviceRooms[uid]).forEach(function (device) {
    let roomArr = deviceRooms[uid][device].split(',');
    roomArr.forEach(function (r) {
      if (roomCheck[r]) {
        roomCheck[r] = roomCheck[r] + 1;
      } else {
        roomCheck[r] = 1;
      }
    });
  });

  //roomCheck
  // room1 = 1
  // room2 = 2
  // room3 = 1
  // room4 = 1

  for (d of Object.keys(deviceRooms[uid])) {
    //d = device
    let roomFound = false;
    let roomArr = deviceRooms[uid][d].split(',');
    let currRoom = roomArr[0];
    roomArr.forEach(function (r) {
      //devicename, room1
      //roomcheck[room1]
      if (roomCheck[r] < roomCheck[currRoom]) {
        currRoom = r;
        roomFound = true;
      }
    });

    if (roomFound) {
      realDBUpdateJSON[d.replace(/\.|\#|\[|\]|\$/g, '_')]['XXXDEVICEDEFXXX'].ghomeRoom = currRoom;
    }
  }
}

function registerClientApi(app) {
  app.get('/syncfinished', utils.rateLimiter(10, 300), async (req, res) => {
    const {
      sub: uid
    } = req.user;
    deviceRooms[uid] = {};
    var attr = { realDBUpdateJSON: {} };
    var usedDeviceReadings = await generateAttributes(uid, attr);
    await generateRoomHint(uid, attr.realDBUpdateJSON);
    uidlog(uid, 'Write to real DB');
    await utils.getRealDB().ref('/users/' + uid + '/devices').set(attr.realDBUpdateJSON);
    uidlog(uid, 'Done');

    uidlog(uid, 'MAPPING CREATION FINISHED');
    res.send(usedDeviceReadings);
  });

  app.post('/genmappings', utils.rateLimiter(10, 300), async (req, res) => {
    const {
      sub: uid
    } = req.user;
    const devicesJSON = req.body;

    deviceRooms[uid] = {};
    var realDBUpdateJSON = {};
    var attr = { realDBUpdateJSON: {}, devicesJSON: devicesJSON };
    var usedDeviceReadings = await generateAttributes(uid, attr);
    await generateRoomHint(uid, attr.realDBUpdateJSON);
    uidlog(uid, 'Write to real DB');
    await utils.getRealDB().ref('/users/' + uid + '/devices').set(attr.realDBUpdateJSON);
    uidlog(uid, 'Done');

    uidlog(uid, 'MAPPING CREATION FINISHED');
    res.send(usedDeviceReadings);
  });

  app.post('/3.0/genmappings', utils.rateLimiter(10, 300), async (req, res) => {
    const {
      sub: uid
    } = req.user;
    const devicesJSON = req.body;

    deviceRooms[uid] = {};
    var realDBUpdateJSON = {};
    var attr = { realDBUpdateJSON: realDBUpdateJSON, devicesJSON: devicesJSON };
    var usedDeviceReadings = await generateAttributes(uid, attr);
    await generateRoomHint(uid, attr.realDBUpdateJSON);
    uidlog(uid, 'Write to real DB');
    await utils.getRealDB().ref('/users/' + uid + '/devices').set(attr.realDBUpdateJSON);
    uidlog(uid, 'Done');

    uidlog(uid, 'MAPPING CREATION FINISHED');
    res.send({
      readings: usedDeviceReadings,
      mappings: attr.realDBUpdateJSON
    });
  });

  app.post('/initsync', async (req, res) => {
    const {
      sub: uid
    } = req.user;
    await utils.initSync(uid);
    res.send({});
  });

  app.get('/deleteuseraccount', async (req, res) => {
    const {
      sub: uid
    } = req.user;
    uidlog(uid, 'deleteuseraccount');

    //delete all firestore data
    var batch = admin.firestore().batch();
    try {
      var ref = await admin.firestore().collection(uid).doc('devices').collection('devices').get();
      for (var r of ref.docs) {
        batch.delete(r.ref);
      }
    } catch (err) {
      uiderror(uid, 'Device deletion failed: ' + err);
    }
    try {
      var ref = await admin.firestore().collection(uid).doc('devices').collection('attributes').get();
      for (var r of ref.docs) {
        batch.delete(r.ref);
      }
    } catch (err) {
      uiderror(uid, 'Attribute deletion failed: ' + err);
    }
    try {
      var ref = await admin.firestore().collection(uid).get();
      for (var r of ref.docs) {
        batch.delete(r.ref);
      }
    } catch (err) {
      uiderror(uid, 'Realtime DB deletion failed: ' + err);
    }
    batch.commit();

    //delete all realtime database data
    await admin.database().ref('users/' + uid).remove();

    //delete user in auth0
    var options = {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        "client_id": settings.AUTH0_MGM_CLIENTID,
        "client_secret": settings.AUTH0_MGM_CLIENTSECRET,
        "audience": settings.AUTH0_DOMAIN + "/api/v2/",
        "grant_type": "client_credentials"
      })
    };
    //get token
    var token = await fetch(settings.AUTH0_DOMAIN + '/oauth/token', options);
    var t = await token.json();

    //delete user
    await fetch(settings.AUTH0_DOMAIN + '/api/v2/users/' + uid, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + t.access_token
      }
    });

    //delete Firebase user
    var firebase = require('firebase');
    var user = firebase.auth().currentUser;
    await user.delete();

    res.send({});
  });

  app.get('/getfeaturelevel', (req, res) => {
    res.send({
      featurelevel: settings.FEATURELEVEL,
      changelog: settings.CHANGELOG
    });
  });

  app.get('/getsyncfeaturelevel', async (req, res) => {
    const {
      sub: uid
    } = req.user;
    var featurelevel = await utils.getSyncFeatureLevel(uid);
    res.send({
      featurelevel: featurelevel
    });
  });

  //BACKWARD COMPATIBILITY
  app.post('/updateinformid', async (req, res) => {
    const {
      sub: uid
    } = req.user;
    uidlog(uid, 'PLEASE UPDATE, deprecated function /updateinformid called');
    res.send({});
  });

  app.get('/getconfiguration', (req, res) => {
    res.send({
      devicetypes: utils.getGoogleDeviceTypes()
    });
  });
}

module.exports = {
  registerClientApi
}