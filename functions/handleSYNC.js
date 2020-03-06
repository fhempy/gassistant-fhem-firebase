const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');
const settings = require('./settings.json');

const uidlog = require('./logger.js').uidlog;
const uiderror = require('./logger.js').uiderror;
const createDirective = require('./utils.js').createDirective;

async function setSyncFeatureLevel(uid) {
  await utils.getFirestoreDB().collection(uid).doc('state').set({
    featurelevel: settings.FEATURELEVEL
  }, {
    merge: true
  });
  await utils.getFirestoreDB().collection(uid).doc('msgs').collection('firestore2fhem').add({
    msg: 'UPDATE_SYNCFEATURELEVEL',
    featurelevel: settings.FEATURELEVEL,
    ts: Date.now()
  });
  await utils.getRealDB().ref('users/' + uid + '/lastSync').set({
    ts: Date.now()
  });
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
  await admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({
    msg: 'REPORTSTATEALL',
    id: reqId,
    delay: 40,
    ts: Date.now()
  });
  res.send(response);
}

var processSYNC = function (uid, devices) {
  const payload = {
    devices: []
  };

  for (let di in devices) {
    const device = devices[di];

    try {
      if (device.mappings.On ||
        device.mappings.Modes ||
        device.mappings.Toggles ||
        device.mappings.Volumme ||
        device.mappings.Brightness ||
        device.mappings.HSVBrightness ||
        device.mappings.Hue ||
        device.mappings.RGB ||
        device.mappings.Scene ||
        device.mappings.CurrentTemperature ||
        device.mappings.TargetTemperature ||
        device.mappings.OccupancyDetected ||
        device.mappings.StartStop ||
        device.mappings.Dock ||
        device.mappings.OpenClose ||
        device.mappings.Locate ||
        device.mappings.FanSpeed ||
        device.mappings.Timer ||
        device.mappings.ArmDisarm ||
        device.mappings.TemperatureControlSetCelsius ||
        device.mappings.TemperatureControlAmbientCelsius ||
        device.mappings.CameraStream ||
        device.mappings.LightEffectsColorLoop ||
        device.mappings.LightEffectsSleep ||
        device.mappings.LightEffectsWake ||
        device.mappings.CurrentRelativeHumidity ||
        device.mappings.TargetRelativeHumidity ||
        device.mappings.LockCurrentState ||
        device.mappings.LockTargetState ||
        device.mappings.Reboot ||
        device.mappings.SoftwareUpdate ||
        device.mappings.EnergyStorageDescriptive ||
        device.mapings.EnergyStorageExact) {
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
          customData: {
            device: device.device
          },
          otherDeviceIds: [{
            deviceId: device.device
          }],
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
          } else if (device.mappings.CameraStream) {
            d.type = 'action.devices.types.CAMERA';
          } else if (device.mappings.CurrentRelativeHumidity) {
            d.type = 'action.devices.types.HUMIDIFIER';
          } else if (device.mappings.LockTargetState || device.mappings.LockCurrentState) {
            d.type = 'action.devices.types.LOCK';
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
          device.mappings.Toggles.forEach(function (toggle) {
            availableTogglesList.push(toggle.toggle_attributes);
          });

          d.attributes.availableToggles = availableTogglesList;
        }

        //HumiditySetting
        if (device.mappings.CurrentRelativeHumidity || device.mappings.TargetRelativeHumidity) {
          if (!device.mappings.TargetTemperature && device.mappings.TargetRelativeHumidity) {
            d.traits.push("action.devices.traits.HumiditySetting");
            //default values
            var minHumidity = 0;
            var maxHumidity = 100;
            if (device.mappings.TargetRelativeHumidity && device.mappings.TargetRelativeHumidity.minHumidity) {
              minHumidity = device.mappings.TargetRelativeHumidity.minHumidity;
            }
            if (device.mappings.TargetRelativeHumidity && device.mappings.TargetRelativeHumidity.maxHumidity) {
              maxHumidity = device.mappings.TargetRelativeHumidity.maxHumidity;
            }
            //attributes
            if (device.mappings.TargetRelativeHumidity) {
              d.attributes.humiditySetpointRange = {
                minPercent: minHumidity,
                maxPercent: maxHumidity
              };
            }
            if (!device.mappings.TargetRelativeHumidity) {
              d.attributes.queryOnlyHumiditySetting = true;
            }
            if (!device.mappings.CurrentRelativeHumidity) {
              d.attributes.commandOnlyHumiditySetting = true;
            }
          }
        }

        //LockUnlock
        if (device.mappings.LockCurrentState || device.mappings.LockTargetState) {
          d.traits.push("action.devices.traits.LockUnlock");
        }

        //SoftwareUpdate
        if (device.mappings.SoftwareUpdate) {
          d.traits.push("action.devices.traits.SoftwareUpdate");
        }

        //Reboot
        if (device.mappings.Reboot) {
          d.traits.push("action.devices.traits.Reboot");
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

        //EnergyStorage
        if (device.mappings.EnergyStorageDescriptive || device.mappings.EnergyStorageExact) {
          d.traits.push("action.devices.traits.EnergyStorage");
          var es;
          if (device.mappings.EnergyStorageExact) {
            es = device.mappings.EnergyStorageExact[0];
          } else {
            es = device.mappings.EnergyStorageDescriptive;
          }
          d.attributes.queryOnlyEnergyStorage = es.queryOnlyEnergyStorage ? true : false;
          d.attributes.energyStorageDistanceUnitForUX = es.energyStorageDistanceUnitForUX ? es.energyStorageDistanceUnitForUX : "KILOMETERS";
          d.attributes.isRechargeable = es.isRechargeable ? true : false;
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

        //LinkedDevices
        if (device.mappings.LinkedDevices) {
          d.traits.push("action.devices.traits.StatusReport");
        }

        //Modes
        if (device.mappings.Modes) {
          d.traits.push("action.devices.traits.Modes");
          //Attributes
          let availableModesList = [];
          device.mappings.Modes.forEach(function (mode) {
            availableModesList.push(mode.mode_attributes);
          });

          d.attributes.availableModes = availableModesList;
        }

        //TemperatureSetting
        if (device.mappings.TargetTemperature) {
          d.attributes.thermostatTemperatureUnit = 'C';
          //FIXME: do not define anything in server.js
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
          d.attributes.thermostatTemperatureUnit = 'C';
          d.attributes.availableThermostatModes = 'off';
          d.attributes.queryOnlyTemperatureSetting = 'true';
          d.traits.push("action.devices.traits.TemperatureSetting");
        }

        //TemperatureControl
        if (device.mappings.TemperatureControlSetCelsius || device.mappings.TemperatureControlAmbientCelsius) {
          d.attributes.temperatureRange = {
            minThresholdCelsius: device.mappings.TemperatureControlSetCelsius.minCelsius ? device.mappings.TemperatureControlSetCelsius.minCelsius : 0,
            maxThresholdCelsius: device.mappings.TemperatureControlSetCelsius.maxCelsius ? device.mappings.TemperatureControlSetCelsius.maxCelsius : 300
          };
          d.attributes.temperatureStepCelsius = device.mappings.TemperatureControlSetCelsius.stepCelsius ? device.mappings.TemperatureControlSetCelsius.stepCelsius : 1;
          d.attributes.temperatureUnitForUX = device.mappings.TemperatureControlSetCelsius.formatUx ? device.mappings.TemperatureControlSetCelsius.formatUx : "C";
          if (device.mappings.TemperatureControlSetCelsius && device.mappings.TemperatureControlAmbientCelsius) {
            d.attributes.queryOnlyTempeartureControl = false;
            d.attributes.commandOnlyTemperatureControl = false;
          } else if (device.mappings.TemperatureControlSetCelsius) {
            d.attributes.queryOnlyTemperatureControl = false;
            d.attributes.commandOnlyTemperatureControl = true;
          } else if (device.mappings.TemperatureControlAmbientCelsius) {
            d.attributes.queryOnlyTemperatureControl = true;
            d.attributes.commandOnlyTemperatureControl = false;
          }
          d.traits.push("action.devices.traits.TemperatureControl");
        }

        //CameraStream
        if (device.mappings.CameraStream) {
          d.attributes.cameraStreamSupportedProtocols = device.mappings.CameraStream.supportedProtocols ? device.mappings.CameraStream.supportedProtocols : ['hls', 'dash', 'smooth_stream', 'progressive_mp4'];
          d.attributes.cameraStreamNeedAuthToken = device.mappings.CameraStream.authToken ? true : false;
          d.attributes.cameraStreamNeedDrmEncryption = device.mappings.CameraStream.drm ? device.mappings.CameraStream.drm : false;
          d.traits.push("action.devices.traits.CameraStream");
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
        } else if (device.mappings.ColorTemperature) {
          d.attributes.colorTemperatureRange = {
            //FIXME get values from device mapping
            temperatureMinK: 2000,
            temperatureMaxK: 9000
          };
          if (device.mappings.ColorTemperature.commandOnlyColorSetting)
            d.attributes.commandOnlyColorSetting = true;
          d.traits.push("action.devices.traits.ColorSetting");
        }

        //LightEffects
        if (device.mappings.LightEffectsColorLoop || device.mappings.LightEffectsSleep || device.mappings.LightEffectsWake) {
          d.attributes.supportedEffects = [];
          if (device.mappings.LightEffectsColorLoop)
            d.attributes.supportedEffects.push('colorLoop');

          if (device.mappings.LightEffectsSleep) {
            d.attributes.defaultSleepDuration = device.mappings.LightEffectsSleep.defaultDuration || 1800;
            d.attributes.supportedEffects.push('sleep');
          }

          if (device.mappings.LightEffectsWake) {
            d.attributes.defaultWakeDuration = device.mappings.LightEffectsWake.defaultDuration || 1800;
            d.attributes.supportedEffects.push('wake');
          }
          // device.mappings.LightEffects.cmds.forEach(function (cmd) {
          //   var match = cmd.match(/(.*):(.*)/);
          //   if (match)
          //     d.attributes.supportedEffects.push(match[1]);
          // });
          d.traits.push("action.devices.traits.LightEffects");
        }

        //Scene
        if (device.mappings.Scene) {
          d.traits.push("action.devices.traits.Scene");

          //create separate device for each scene
          if (Array.isArray(device.mappings.Scene)) {
            device.mappings.Scene.forEach(function (scene) {
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
          uidlog(uid, device.device + ': ' + JSON.stringify(d));
        }
      }
    } catch (err) {
      uiderror(uid, 'Error with device ' + device.device + ': ' + err, err);
    }
  }

  return payload;
} // processSYNC

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