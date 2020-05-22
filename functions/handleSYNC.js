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
  // Based on last comment from Google this is not required any more
  // await admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({
  //   msg: 'REPORTSTATEALL',
  //   id: reqId,
  //   delay: 40,
  //   ts: Date.now()
  // });
  res.send(response);
}

var processSYNC = function (uid, devices) {
  const payload = {
    devices: []
  };

  for (let di in devices) {
    const device = devices[di];

    try {
      if (Object.keys(device.mappings).length > 0) {
        //console.log(device);

        //console.log("Start handling ", device.ghomeName);

        let d = {
          id: device.uuid_base,
          deviceInfo: {
            manufacturer: device.type,
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
        //OnOff
        if (device.mappings.On || device.mappings.OccupancyDetected) {
          d.traits.push("action.devices.traits.OnOff");
          if (device.mappings.On && !device.mappings.On.reading)
            d.attributes.commandOnlyOnOff = true;
          if (device.mappings.OccupancyDetected && !device.mappings.OccupancyDetected.reading)
            d.attributes.commandOnlyOnOff = true;
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
          //TODO utils.sendCmd2Fhem(setreading device.device gassistantExamples "Reboot gassistant.")
          //reference to Google Trait documentation might be useful
          //utils.addRequestExamples(uid, device, "Starte DEVICE neu.");
        }

        //NetworkControl
        if (device.mappings.NetworkSettings || device.mappings.GuestNetwork || device.mappings.NetworkProfile || device.mappings.TestNetworkSpeed) {
          d.traits.push("action.devices.traits.NetworkControl");
          if (device.mappings.GuestNetwork) {
            d.attributes.supportsEnablingGuestNetwork = true;
            d.attributes.supportsDisablingGuestNetwork = true;
          }
          if (device.mappings.NetworkProfile) {
            d.attributes.networkProfiles = device.mappings.NetworkProfile.profiles || [];
            d.attributes.supportsEnablingNetworkProfile = true;
            d.attributes.supportsDisablingNetworkProfile = true;
          }
          if (device.mappings.TestNetworkSpeed) {
            d.attributes.supportsNetworkDownloadSpeedTest = true;
            d.attributes.supportsNetworkUploadSpeedTest = true;
          }
          if (device.mappings.GuestNetworkPassword) {
            d.attributes.supportsGettingGuestNetworkPassword = true;
          }
        }

        //Rotation
        if (device.mappings.RotationDegrees || device.mappings.RotationPercent) {
          d.traits.push("action.devices.traits.Rotation");
          d.attributes.supportsPercent = false;
          d.attributes.supportsDegrees = false;
          //Degrees
          if (device.mappings.RotationDegrees) {
            d.attributes.supportsDegrees = true;
            if (device.mappings.RotationDegrees.min &&
              device.mappings.RotationDegrees.max) {
              d.attributes.rotationDegreesRange = {
                rotationDegreesMin: device.mappings.RotationDegrees.min,
                rotationDegreesMax: device.mappings.RotationDegrees.max
              };
            } else {
              d.attributes.rotationDegreesRange = {
                rotationDegreesMin: 0,
                rotationDegreesMax: 360
              };
            }
            if (device.mappings.RotationDegrees.supportsContinuousRotation)
              d.attributes.supportsContinuousRotation = device.mappings.RotationDegrees.supportsContinuousRotation;
          }
          //Percent
          if (device.mappings.RotationPercent) {
            d.attributes.supportsPercent = true;
            if (device.mappings.RotationPercent.supportsContinuousRotation)
              d.attributes.supportsContinuousRotation = device.mappings.RotationPercent.supportsContinuousRotation;
          }
          //commandOnly
          if (!device.mappings.RotationDegrees.reading && !device.mappings.RotationPercent.reading) {
            d.attributes.commandOnlyRotation = true;
          }
        }

        //ArmDisarm
        if (device.mappings.ArmDisarm) {
          d.traits.push("action.devices.traits.ArmDisarm");
        }

        //Brightness
        if (device.mappings.Brightness) {
          d.traits.push("action.devices.traits.Brightness");
        }

        //StartStop
        if (device.mappings.StartStop) {
          d.traits.push("action.devices.traits.StartStop");
          //Attributes
          if (device.mappings.StartStop.cmdPause)
            d.attributes.pausable = true;
          else
            d.attributes.pausable = false;

          if (device.mappings.StartStopZones) {
            d.attributes.availableZones = device.mappings.StartStopZones.availableZones;
          }
        }

        //TransportControl
        var transportControl = {
          mediaClosedCaptioningOn: "CAPTION_CONTROL",
          mediaClosedCaptioningOff: "CAPTION_CONTROL",
          mediaNext: "NEXT",
          mediaPause: "PAUSE",
          mediaPrevious: "PREVIOUS",
          mediaResume: "RESUME",
          mediaRepeatMode: "SET_REPEAT",
          mediaSeekRelative: "SEEK_RELATIVE",
          mediaSeekToPosition: "SEEK_TO_POSITION",
          mediaShuffle: "SHUFFLE",
          mediaStop: "STOP"
        };
        d.attributes.transportControlSupportedCommands = [];
        for (var tc in transportControl) {
          if (device.mappings[tc]) {
            d.attributes.transportControlSupportedCommands.push(transportControl[tc]);
          }
        }
        if (d.attributes.transportControlSupportedCommands.length) {
          d.traits.push("action.devices.traits.TransportControl");
        } else {
          delete d.attributes.transportControlSupportedCommands;
        }

        //Volume
        if (device.mappings.Volume) {
          d.traits.push("action.devices.traits.Volume");
          d.attributes.volumeMaxLevel = device.mappings.Volume.volumeMaxLevel || 100;
          if (device.mappings.Mute) {
            d.attributes.volumeCanMuteAndUnmute = true;
          } else {
            d.attributes.volumeCanMuteAndUnmute = false;
          }
          d.attributes.volumeDefaultPercentage = device.mappings.Volume.defaultVolume || 15;
          d.attributes.levelStepSize = device.mappings.Volume.levelStepSize || 1;
          if (device.mappings.Volume.reading) {
            d.attributes.commandOnlyVolume = false;
          } else {
            d.attributes.commandOnlyVolume = true;
          }
        }

        //SensorState
        if (device.mappings.WaterLeak || device.mappings.FilterCleanliness || device.mappings.AirQuality || device.mappings.HEPAFilterLifeTime ||
          device.mappings.CarbonMonoxideLevel || device.mappings.CarbonMonoxideLevelNumeric || device.mappings.PreFilterLifeTime ||
          device.mappings.Max2FilterLifeTime || device.mappings.SmokeLevel || device.mappings.SmokeLevelNumeric) {

          d.traits.push("action.devices.traits.SensorState");
          d.attributes.sensorStatesSupported = [];
        }
        // - AirQuality
        if (device.mappings.AirQuality) {
          var availableAQStates = [];
          for (var entry of device.mappings.AirQuality.values) {
            var match = entry.match('^((.*?)=)?([^:]*)(:(.*))?$');
            availableAQStates.push(match[5]);
          }
          d.attributes.sensorStatesSupported.push({
            name: "AirQuality",
            descriptiveCapabilities: {
              availableStates: availableAQStates
            }
          });
        }
        // - CarbonMonoxideLevel
        if (device.mappings.CarbonMonoxideLevel || device.mappings.CarbonMonoxideLevelNumeric) {
          var sss = {
            name: "CarbonMonoxideLevel"
          };
          if (device.mappings.CarbonMonoxideLevel) {
            var availableCMLStates = [];
            for (var entry of device.mappings.CarbonMonoxideLevel.values) {
              var match = entry.match('^((.*?)=)?([^:]*)(:(.*))?$');
              availableCMLStates.push(match[5]);
            }
            sss.descriptiveCapabilities = {
              availableStates: availableCMLStates
            };
          }
          if (device.mappings.CarbonMonoxideLevelNumeric) {
            sss.numericCapabilities = {
              rawValueUnit: "PARTS_PER_MILLION"
            };
          }
          d.attributes.sensorStatesSupported.push(sss);
        }
        // - SmokeLevel
        if (device.mappings.SmokeLevel || device.mappings.SmokeLevelNumeric) {
          var sss = {
            name: "SmokeLevel"
          };
          if (device.mappings.SmokeLevel) {
            var availableSLStates = [];
            for (var entry of device.mappings.SmokeLevel.values) {
              var match = entry.match('^((.*?)=)?([^:]*)(:(.*))?$');
              availableSLStates.push(match[5]);
            }
            sss.descriptiveCapabilities = {
              availableStates: availableSLStates
            };
          }
          if (device.mappings.SmokeLevelNumeric) {
            sss.numericCapabilities = {
              rawValueUnit: "PARTS_PER_MILLION"
            };
          }
          d.attributes.sensorStatesSupported.push(sss);
        }
        // - HEPAFilterLifeTime
        if (device.mappings.HEPAFilterLifeTime) {
          d.attributes.sensorStatesSupported.push({
            name: "HEPAFilterLifeTime",
            numericCapabilities: {
              rawValueUnit: "PERCENTAGE"
            }
          });
        }
        // - Max2FilterLifeTime
        if (device.mappings.Max2FilterLifeTime) {
          d.attributes.sensorStatesSupported.push({
            name: "Max2FilterLifeTime",
            numericCapabilities: {
              rawValueUnit: "PERCENTAGE"
            }
          });
        }
        // - PreFilterLifeTime
        if (device.mappings.PreFilterLifeTime) {
          d.attributes.sensorStatesSupported.push({
            name: "PreFilterLifeTime",
            numericCapabilities: {
              rawValueUnit: "PERCENTAGE"
            }
          });
        }
        // - WaterLeak
        if (device.mappings.WaterLeak) {
          var availableWlStates = [];
          for (var entry of device.mappings.WaterLeak.values) {
            var match = entry.match('^((.*?)=)?([^:]*)(:(.*))?$');
            availableWlStates.push(match[5]);
          }
          d.attributes.sensorStatesSupported.push({
            name: "WaterLeak",
            descriptiveCapabilities: {
              availableStates: availableWlStates
            }
          });
        }
        // - FilterCleanliness
        if (device.mappings.FilterCleanliness) {
          var availableFilterStates = [];
          for (var entry of device.mappings.FilterCleanliness.values) {
            var match = entry.match('^((.*?)=)?([^:]*)(:(.*))?$');
            availableFilterStates.push(match[5]);
          }
          d.attributes.sensorStatesSupported.push({
            name: "FilterCleanliness",
            descriptiveCapabilities: {
              availableStates: availableFilterStates
            }
          });
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

        //InputSelector
        if (device.mappings.InputSelector) {
          d.traits.push("action.devices.traits.InputSelector");
          //Attributes
          d.attributes.availableInputs = device.mappings.InputSelector.availableInputs;
          d.attributes.orderedInputs = device.mappings.InputSelector.orderedInputs || true;
        }

        //MediaState
        if (device.mappings.MediaPlaybackState || device.mappings.MediaActivityState) {
          d.traits.push("action.devices.traits.MediaState");
          if (device.mappings.MediaPlaybackState) {
            d.attributes.supportPlaybackState = true;
          }
          if (device.mappings.MediaActivityState) {
            d.attributes.supportActivityState = true;
          }
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
          if (!device.mappings.Modes.reading)
            d.attributes.commandOnlyModes = true;
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
          if (device.mappings.TargetTemperature.minThresholdCelsius !== undefined && device.mappings.TargetTemperature.maxThresholdCelsius !== undefined) {
            d.attributes.thermostatTemperatureRange = {
              minThresholdCelsius: device.mappings.TargetTemperature.minThresholdCelsius,
              maxThresholdCelsius: device.mappings.TargetTemperature.maxThresholdCelsius
            };
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
      uiderror(uid, device.device + ': ' + err, err);
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