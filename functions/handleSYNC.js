const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');
const settings = require('./settings.json');

const uidlog = require('./logger.js').uidlog;
const uiderror = require('./logger.js').uiderror;
const createDirective = require('./utils.js').createDirective;

async function setSyncFeatureLevel(uid) {
  await utils.getFirestoreDB().collection(uid).doc('state').set({featurelevel: settings.FEATURELEVEL}, {merge: true});
  await utils.getFirestoreDB().collection(uid).doc('msgs').collection('firestore2fhem').add({msg: 'UPDATE_SYNCFEATURELEVEL', featurelevel: settings.FEATURELEVEL, ts: Date.now()});
  await utils.getRealDB().ref('users/' + uid + '/lastSync').set({ts: Date.now()});
}

async function handleSYNC(uid, reqId, res) {
  uidlog(uid, 'STARTING SYNC');
  setSyncFeatureLevel(uid);
  await createSYNCPayloadResponse(uid, reqId, res);
}

async function createSYNCPayloadResponse(uid, reqId, res) {
  var payload = await createSYNCResponse(uid);
  var response = createDirective(reqId, payload);
  response.payload.agentUserId = uid;
  await admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({msg: 'REPORTSTATEALL', id: reqId, delay: 40, ts: Date.now()});
  res.send(response);
}

var processSYNC = function (uid, devices) {
    const payload = {
        devices: []
    };

    for (let di in devices) {
        const device = devices[di];

        try {
          if (device.mappings.On
              || device.mappings.Modes
              || device.mappings.Toggles
              || device.mappings.Volumme
              || device.mappings.Brightness
              || device.mappings.HSVBrightness
              || device.mappings.Hue
              || device.mappings.RGB
              || device.mappings.Scene
              || device.mappings.CurrentTemperature
              || device.mappings.TargetTemperature
              || device.mappings.OccupancyDetected
              || device.mappings.StartStop
              || device.mappings.Dock
              || device.mappings.OpenClose
              || device.mappings.Locate
              || device.mappings.FanSpeed
              || device.mappings.Timer
              || device.mappings.ArmDisarm) {
              //console.log(device);
  
              //console.log("Start handling ", device.ghomeName);
              
              let d = {
                  id: device.uuid_base,
                  deviceInfo: {
                      manufacturer: 'FHEM_' + device.type,
                      model: (device.model ? device.model : '<unknown>')
                  },
                  name: {
                      name: device.ghomeName
                  },
                  traits: [],
                  attributes: {},
                  customData: {device: device.device},
                  otherDeviceIds: [{ deviceId: device.device }],
              };
              
              d.willReportState = !device.mappings.Scene;
  
              //roomHint
              if (device.ghomeRoom && device.ghomeRoom != '')
                  d.roomHint = device.ghomeRoom;
  
              //DEVICE TYPE
              if (device.service_name) {
                  var gTypes = utils.getGoogleDeviceTypesMappings();
                  if (gTypes[device.service_name] !== undefined) {
                    d.type = gTypes[device.service_name];
                  } else {
                      uiderror(uid, "genericDeviceType " + device.service_name + " not supported in gassistant-fhem");
                      continue;
                  }
              } else {
                  if (device.mappings.TargetTemperature || device.mappings.CurrentTemperature) {
                      d.type = 'action.devices.types.THERMOSTAT';
                  } else if (device.mappings.Brightness || device.mappings.Hue ||
                             device.mappings.RGB || device.mappings.OccupancyDetected ||
                             device.mappings.HSVBrightness) {
                      d.type = 'action.devices.types.LIGHT';
                  } else if (device.mappings.OpenClose) {
                      d.type = 'action.devices.types.BLINDS';
                  } else if (device.mappings.Scene) {
                      d.type = 'action.devices.types.SCENE';
                  } else {
                      d.type = 'action.devices.types.SWITCH';
                  }
              }
  
              //TRAITS
              if (device.mappings.On || device.mappings.OccupancyDetected) {
                  d.traits.push("action.devices.traits.OnOff");
              }
  
              //Toggles
              if (device.mappings.Toggles) {
                  d.traits.push("action.devices.traits.Toggles");
                  //Attributes
                  let availableTogglesList = [];
              		device.mappings.Toggles.forEach(function(toggle) {
              			availableTogglesList.push(toggle.toggle_attributes);
              		});
              		
                  d.attributes.availableToggles = availableTogglesList;
              }

              //ArmDisarm
              if (device.mappings.ArmDisarm) {
                  d.traits.push("action.devices.traits.ArmDisarm");
              }
  
              //Brightness
              if (device.mappings.Brightness || device.mappings.Volume) {
                  d.traits.push("action.devices.traits.Brightness");
              }
  
              //StartStop
              if (device.mappings.StartStop) {
                  d.traits.push("action.devices.traits.StartStop");
                  //Attributes
                  d.attributes.pausable = true;
              }
              
              //FanSpeed
              if (device.mappings.FanSpeed) {
                  d.traits.push("action.devices.traits.FanSpeed");
                  //Attributes
                  d.attributes.availableFanSpeeds = {};
                  d.attributes.availableFanSpeeds.speeds = [];
                  for (var fspeed in device.mappings.FanSpeed.speeds) {
                    var speedDefinition = {};
                    //fspeed (e.g. S1)
                    speedDefinition.speed_name = fspeed;
                    speedDefinition.speed_values = [];
                    for (var lang in device.mappings.FanSpeed.speeds[fspeed].synonyms) {
                      //lang (e.g. de)
                      //device.mappings.FanSpeed.speeds[fspeed].synonyms[lang] (e.g. langsam, stufe 1)
                      speedDefinition.speed_values.push({
                        'speed_synonym': device.mappings.FanSpeed.speeds[fspeed].synonyms[lang],
                        'lang': lang
                      });
                    }
                    d.attributes.availableFanSpeeds.speeds.push(speedDefinition);
                  }
                  d.attributes.availableFanSpeeds.ordered = device.mappings.FanSpeed.ordered;
                  d.attributes.reversible = device.mappings.FanSpeed.reversible;
              }
  
              //Dock
              if (device.mappings.Dock) {
                  d.traits.push("action.devices.traits.Dock");
              }

              //Timer
              if (device.mappings.Timer) {
                  d.traits.push("action.devices.traits.Timer");
                  d.attributes.maxTimerLimitSec = device.mappings.Timer.maxTimerLimitSec;
                  d.attributes.commandOnlyTimer = device.mappings.Timer.commandOnlyTimer;
              }

              //OpenClose
              if (device.mappings.OpenClose) {
                  d.traits.push("action.devices.traits.OpenClose");
                  //Attributes
                  d.attributes.queryOnlyOpenClose = device.mappings.OpenClose.cmdOpen ? false : true;
              }
              
              //Locate
              if (device.mappings.Locate) {
                  d.traits.push("action.devices.traits.Locator");
              }
  
              //Modes
              if (device.mappings.Modes) {
                  d.traits.push("action.devices.traits.Modes");
                  //Attributes
                  let availableModesList = [];
              		device.mappings.Modes.forEach(function(mode) {
              			availableModesList.push(mode.mode_attributes);
              		});
              		
                  d.attributes.availableModes = availableModesList;
              }
  
              //TemperatureSetting
              if (device.mappings.TargetTemperature) {
                  d.attributes = {
                      //FIXME: do not define anything in server.js
                      thermostatTemperatureUnit: 'C'
                  };
                  if (device.mappings.ThermostatModes) {
                    //iterate over thermostat modes array
                    var modes = [];
                    device.mappings.ThermostatModes.cmds.forEach(function (mode) {
                      var m = mode.split(':');
                      modes.push(m[0]);
                    });
                    d.attributes.availableThermostatModes = modes.toString();
                  } else {
                    d.attributes.availableThermostatModes = 'off,heat';
                  }
                  d.traits.push("action.devices.traits.TemperatureSetting");
              } else if (device.mappings.CurrentTemperature) {
                  d.attributes = {
                      //FIXME: do not define anything in server.js
                      thermostatTemperatureUnit: 'C',
                      availableThermostatModes: 'off',
                      queryOnlyTemperatureSetting: true
                  };
                  d.traits.push("action.devices.traits.TemperatureSetting");
              }
  
              //ColorSetting / ColorTemperature
              if (device.mappings.RGB) {
                  d.attributes.colorModel = 'rgb';
                  if (device.mappings.ColorTemperature) {
                      d.attributes.colorTemperatureRange = {
                          //FIXME get values from device mapping
                          temperatureMinK: 2000,
                          temperatureMaxK: 9000
                      };
                  }
                  if (device.mappings.RGB.commandOnlyColorSetting)
                      d.attributes.commandOnlyColorSetting = true;
                  d.traits.push("action.devices.traits.ColorSetting");
              } else if (device.mappings.Hue) {
                  d.attributes.colorModel = 'hsv';
                  if (device.mappings.ColorTemperature) {
                      d.attributes.colorTemperatureRange = {
                          //FIXME get values from device mapping
                          temperatureMinK: 2000,
                          temperatureMaxK: 9000
                      };
                  }
                  if (device.mappings.Hue.commandOnlyColorSetting)
                      d.attributes.commandOnlyColorSetting = true;
                  d.traits.push("action.devices.traits.ColorSetting");
              }
  
              //Scene
              if (device.mappings.Scene) {
                  d.traits.push("action.devices.traits.Scene");
  
                  //create separate device for each scene
                  if (Array.isArray(device.mappings.Scene)) {
                      device.mappings.Scene.forEach(function(scene) {
                          //Attributes
                          if (scene.cmdOff) {
                              d.attributes.sceneReversible = true;
                          } else {
                              d.attributes.sceneReversible = false;
                          }
                          let d2 = {
                              id: device.uuid_base.replace(/[^\w_\-=#;:?@&]/g, '_') + '-' + scene.scenename,
                              type: 'action.devices.types.SCENE',
                              deviceInfo: {
                                  manufacturer: 'FHEM_' + device.type,
                                  model: (device.model ? device.model : '<unknown>')
                              },
                              name: {
                                  name: scene.scenename
                              },
                              traits: ['action.devices.traits.Scene'],
                              attributes: {
                                  sceneReversible: false
                              },
                              customData: {
                                device: device.device,
                                scenename: scene.scenename
                              }
                          };
                          payload.devices.push(d2);
                      });
                  }
              } else {
                  payload.devices.push(d);
                  uidlog(uid, device.device + ': '+ JSON.stringify(d));
              }
          }
        } catch (err) {
          uiderror(uid, 'Error with device ' + device.device + ': ' + err);
        }
    }

    return payload;
}// processSYNC

async function createSYNCResponse(uid) {
  var NO_CACHE = 1;
  var devices = await utils.loadDevices(uid, NO_CACHE);
  if (Object.keys(devices).length === 0) {
    devices['setupdevice'] = {
      PossibleSets: "on off",
      alias: "please setup FHEM Connect client",
      connection: "http://127.0.0.1:8083/fhem",
      device: "setupdevice",
      ghomeName: "setup info: https://bit.ly/fhemconnect",
      ghomeRoom: "FHEM",
      mappings: {
        On: {
          characteristic_type: "On",
          cmdOff: "off",
          cmdOn: "on",
          device: "please setup FHEM Connect client",
          format: "bool",
          reading: ["state"],
          valueOff: "off"
        }
      },
      model: "FHEM Connect",
      name: "please setup FHEM Connect client",
      room: "FHEM",
      type: "dummy",
      uuid_base: "setuprequired"
    };
  }
  //generate sync response
  var response = processSYNC(uid, devices);
  //await uidlog(uid, 'sync response: ' + JSON.stringify(response));
  return response;
}

module.exports = {
  handleSYNC
};
