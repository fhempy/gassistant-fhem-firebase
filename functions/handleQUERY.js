const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');
const createDirective = require('./utils.js').createDirective;

const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;

async function handleQUERY(uid, reqId, res, input) {
  await createQUERYPayloadResponse(input, uid, reqId, res);
}

async function createQUERYPayloadResponse(input, uid, reqId, res) {
  //read current value from firestore
  var payload = await processQUERY(uid, input);
  var response = createDirective(reqId, payload);
  uidlog(uid, 'final response QUERY: ' + JSON.stringify(response));
  //admin.firestore().collection(uid).doc('msgs').collection('firestore2google').add({msg: response, id: reqId});
  res.send(response);
}

async function processQUERY(uid, input, reportstate) {
  let response = null;

  let devices = {};
  var allDevices;

  //if (input.payload.devices.length > 1) {
  //preload all devices
  try {
    allDevices = await utils.getAllDevicesAndReadings(uid);
    uidlog(uid, "getAllDevicesAndReadings finished");
  } catch (err) {
    uiderror(uid, 'getAllDevicesAndReadings failed with ' + err.stack, err);
  }
  //}

  for (d of input.payload.devices) {
    let device;
    let readings;

    devices[d.id] = {};

    uidlog(uid, "QUERY: " + d.customData.device);
    try {
      var dd;
      try {
        if (allDevices) {
          dd = allDevices[d.customData.device];
        } else {
          dd = await utils.getDeviceAndReadings(uid, d.customData.device);
          uidlog(uid, "getDeviceReadingValues finished");
        }
        device = dd.device;
        readings = dd.readings;
      } catch (err) {
        if (d.customData.device !== 'setupdevice') {
          await utils.initSync(uid);
          new Error('Failed to load:' + err);
        }
        continue;
      }

      if (Object.keys(dd.device).length === 0) {
        //return deviceNotFound
        return {
          errorCode: 'deviceNotFound'
        };
      }

      if (!device.mappings) {
        uiderror(uid, "No mappings defined for device " + device.name);
        continue;
      }

      //Errors check
      if (device.mappings.On && device.mappings.On.device !== device.name) {
        //no error check, as other device is used for on off
      } else {
        if (device.mappings.Errors) {
          for (var er in device.mappings.Errors) {
            const errCheck = await utils.cached2Format(uid, device.mappings.Errors[er], readings);
            if (errCheck === "ERROR") {
              devices[d.id].status = "ERROR";
              devices[d.id].errorCode = er;
            }
          }
          if (devices[d.id].errorCode) {
            continue;
          }
        }
      }

      // If there is a current or a target temperature, we probably have a thermostat
      if (device.mappings.CurrentTemperature || device.mappings.TargetTemperature) {
        if (device.mappings.TargetTemperature) {
          const desiredTemp = parseFloat(await utils.cached2Format(uid, device.mappings.TargetTemperature, readings));
          let thermostatMode = 'heat';
          if (device.mappings.ThermostatModes) {
            thermostatMode = await utils.cached2Format(uid, device.mappings.ThermostatModes, readings);
          } else {
            //BACKWARD COMPATIBILITY
            uidlog(uid, 'OLDFUNCTION no thermostat modes - SYNC required');
            if (desiredTemp == device.mappings.TargetTemperature.minValue) {
              thermostatMode = 'off';
            }
            devices[d.id].thermostatMode = thermostatMode;
          }

          devices[d.id].thermostatMode = thermostatMode;
          devices[d.id].thermostatTemperatureSetpoint = desiredTemp;
        } else {
          devices[d.id].thermostatMode = 'off';
        }

        if (device.mappings.CurrentTemperature) {
          const currentTemp = parseFloat(await utils.cached2Format(uid, device.mappings.CurrentTemperature, readings));
          devices[d.id].thermostatTemperatureAmbient = currentTemp;
        }

        if (device.mappings.CurrentRelativeHumidity) {
          devices[d.id].thermostatHumidityAmbient = parseFloat(await utils.cached2Format(uid, device.mappings.CurrentRelativeHumidity, readings));
        }
      }

      //TemperatureControl
      if (device.mappings.TemperatureControlSetCelsius || device.mappings.TemperatureControlAmbientCelsius) {

        //TemperatureControlSetCelsius = {reading: 'targetTemperature', cmd: 'desired', minCelsius: 0, maxCelsius: 300, stepCelsius: 10, formatUx: 'C'};
        //TemperatureControlAmbientCelsius = {reading: 'currentTemperatur'};

        if (device.mappings.TemperatureControlSetCelsius) {
          const temperatureSetpointCelsius = await utils.cached2Format(uid, device.mappings.TemperatureControlSetCelsius, readings);
          devices[d.id].temperatureSetpointCelsius = temperatureSetpointCelsius;
        }

        if (device.mappings.TemperatureControlAmbientCelsius) {
          const temperatureAmbientCelsius = await utils.cached2Format(uid, device.mappings.TemperatureControlAmbientCelsius, readings);
          devices[d.id].temperatureAmbientCelsius = temperatureAmbientCelsius;
        }
        devices[d.id].status = "SUCCESS";
      }

      //OnOff
      if (device.mappings.On && device.mappings.On.reading) {
        var reachable = 1;
        const turnedOn = await utils.cached2Format(uid, device.mappings.On, allDevices[device.mappings.On.device].readings);
        if (device.mappings.Reachable) {
          reachable = await utils.cached2Format(uid, device.mappings.Reachable, readings);
        }
        if (!reachable)
          devices[d.id].on = false;
        else
          devices[d.id].on = turnedOn;
      }

      //ArmDisarm
      if (device.mappings.ArmDisarm) {
        devices[d.id].isArmed = await utils.cached2Format(uid, device.mappings.ArmDisarm, readings) === 'ARMED' ? true : false;
        if (device.mappings.ArmDisarm.exitAllowance)
          devices[d.id].exitAllowance = device.mappings.ArmDisarm.exitAllowance;
      }

      //OccupancySensor
      if (device.mappings.OccupancyDetected) {
        devices[d.id].on = await utils.cached2Format(uid, device.mappings.OccupancyDetected, readings);
      }

      //HumidifierSetting
      if (device.mappings.CurrentRelativeHumidity || device.mappings.TargetRelativeHumidity) {
        //humiditySetpointPercent
        if (device.mappings.TargetRelativeHumidity) {
          devices[d.id].humiditySetpointPercent = await utils.cached2Format(uid, device.mappings.TargetRelativeHumidity, readings);
        }
        //humidityAmbientPercent
        if (device.mappings.CurrentRelativeHumidity) {
          devices[d.id].humidityAmbientPercent = await utils.cached2Format(uid, device.mappings.CurrentRelativeHumidity, readings);
        }
        devices.status = "SUCCESS";
      }

      //Dispense
      if (device.mappings.Dispense) {
        devices[d.id].dispenseItems = [];
        for (var item of device.mappings.Dispense.supportedDispenseItems) {
          var dispItem = {};
          var itemName = item.item_name;
          dispItem.itemName = itemName;
          if (device.mappings.DispenseAmountRemaining) {
            dispItem.amountRemaining = {};
            for (var dar of device.mappings.DispenseAmountRemaining) {
              if (itemName == dar["itemName"]) {
                dispItem.amountRemaining.amount = await utils.cached2Format(uid, dar, readings);
                dispItem.amountRemaining.unit = dar["unit"];
              }
            }
          }
          if (device.mappings.DispenseAmountLastDispensed) {
            dispItem.amountLastDispensed = {};
            for (var dald of device.mappings.DispenseAmountLastDispensed) {
              if (itemName == dald["itemName"]) {
                dispItem.amountLastDispensed.amount = await utils.cached2Format(uid, dald, readings);
                dispItem.amountLastDispensed.unit = dald["unit"];
              }
            }
          }
          if (device.mappings.DispenseIsCurrentlyDispensing) {
            for (var dicd of device.mappings.DispenseIsCurrentlyDispensing) {
              if (itemName == dicd["itemName"]) {
                dispItem.isCurrentlyDispensing = await utils.cached2Format(uid, dicd, readings);
              }
            }
          }
          devices[d.id].dispenseItems.push(dispItem);
        }
        devices[d.id].status = "SUCCESS";
      }

      //Cook
      if (device.mappings.Cook) {
        devices[d.id].currentCookingMode = await utils.cached2Format(uid, device.mappings.CookCurrentCookingMode, readings);
        if (device.mappings.CookCurrentFoodPreset)
          devices[d.id].currentFoodPreset = await utils.cached2Format(uid, device.mappings.CookCurrentFoodPreset, readings);
        if (device.mappings.CookCurrentFoodQuantity)
          devices[d.id].currentFoodQuantity = await utils.cached2Format(uid, device.mappings.CookCurrentFoodQuantity, readings);
        if (device.mappings.CookCurrentFoodUnit)
          devices[d.id].currentFoodUnit = await utils.cached2Format(uid, device.mappings.CookCurrentFoodUnit, readings);
        devices[d.id].status = "SUCCESS";
      }

      //LockUnlock
      if (device.mappings.LockCurrentState || device.mappings.LockTargetState) {
        //isLocked
        devices[d.id].isLocked = await utils.cached2Format(uid, device.mappings.LockCurrentState, readings) === "SECURED";
        //isJammed
        devices[d.id].isJammed = await utils.cached2Format(uid, device.mappings.LockCurrentState, readings) === "JAMMED";
      }

      //SoftwareUpdate
      if (device.mappings.SoftwareUpdate) {
        //FIXME support last update timestamp
        //devices[d.id].lastSoftwareUpdateUnixTimestampSec = await utils.cached2Format(uid, device.mappings.SoftwareUpdate, readings);
      }

      //OpenClose
      if (device.mappings.OpenClose && device.mappings.OpenClose.reading) {
        if (device.mappings.CurrentPosition) {
          try {
            devices[d.id].openPercent = await utils.cached2Format(uid, device.mappings.CurrentPosition, readings);
          } catch (err) {
            devices[d.id].openPercent = await utils.cached2Format(uid, device.mappings.OpenClose, readings) === 'CLOSED' ? 0 : 100;
          }
        } else {
          //queryonly
          devices[d.id].openPercent = await utils.cached2Format(uid, device.mappings.OpenClose, readings) === 'CLOSED' ? 0 : 100;
        }
      }

      //SensorState
      if (device.mappings.WaterLeak || device.mappings.FilterCleanliness || device.mappings.AirQuality || device.mappings.HEPAFilterLifeTime ||
        device.mappings.CarbonMonoxideLevel || device.mappings.CarbonMonoxideLevelNumeric || device.mappings.PreFilterLifeTime ||
        device.mappings.Max2FilterLifeTime || device.mappings.SmokeLevel || device.mappings.SmokeLevelNumeric) {
        devices[d.id].currentSensorStateData = [];
      }
      // - AirQuality
      if (device.mappings.AirQuality) {
        devices[d.id].status = "SUCCESS";
        var currState = await utils.cached2Format(uid, device.mappings.AirQuality, readings);
        devices[d.id].currentSensorStateData.push({
          name: "AirQuality",
          currentSensorState: currState
        });
      }
      // - HEPAFilterLifeTime
      if (device.mappings.HEPAFilterLifeTime) {
        devices[d.id].status = "SUCCESS";
        var val = await utils.cached2Format(uid, device.mappings.HEPAFilterLifeTime, readings);
        devices[d.id].currentSensorStateData.push({
          name: "HEPAFilterLifeTime",
          rawValue: val
        });
      }
      // - Max2FilterLifeTime
      if (device.mappings.Max2FilterLifeTime) {
        devices[d.id].status = "SUCCESS";
        var val = await utils.cached2Format(uid, device.mappings.Max2FilterLifeTime, readings);
        devices[d.id].currentSensorStateData.push({
          name: "Max2FilterLifeTime",
          rawValue: val
        });
      }
      // - PreFilterLifeTime
      if (device.mappings.PreFilterLifeTime) {
        devices[d.id].status = "SUCCESS";
        var val = await utils.cached2Format(uid, device.mappings.PreFilterLifeTime, readings);
        devices[d.id].currentSensorStateData.push({
          name: "PreFilterLifeTime",
          rawValue: val
        });
      }
      // - CarbonMonoxideLevel
      if (device.mappings.CarbonMonoxideLevel || device.mappings.CarbonMonoxideLevelNumeric) {
        devices[d.id].status = "SUCCESS";
        var cml = {
          name: "CarbonMonoxideLevel"
        };
        if (device.mappings.CarbonMonoxideLevelNumeric) {
          var val = await utils.cached2Format(uid, device.mappings.CarbonMonoxideLevelNumeric, readings);
          cml.rawValue = val;
        }
        if (device.mappings.CarbonMonoxideLevel) {
          cml.currentSensorState = await utils.cached2Format(uid, device.mappings.CarbonMonoxideLevel, readings);
        }
        devices[d.id].currentSensorState.push(cml);
      }
      // - SmokeLevel
      if (device.mappings.SmokeLevel || device.mappings.SmokeLevelNumeric) {
        devices[d.id].status = "SUCCESS";
        var cml = {
          name: "SmokeLevel"
        };
        if (device.mappings.SmokeLevelNumeric) {
          var val = await utils.cached2Format(uid, device.mappings.SmokeLevelNumeric, readings);
          cml.rawValue = val;
        }
        if (device.mappings.SmokeLevel) {
          cml.currentSensorState = await utils.cached2Format(uid, device.mappings.SmokeLevel, readings);
        }
        devices[d.id].currentSensorState.push(cml);
      }
      // - WaterLeak
      if (device.mappings.WaterLeak) {
        devices[d.id].status = "SUCCESS";
        var currState = await utils.cached2Format(uid, device.mappings.WaterLeak, readings);
        devices[d.id].currentSensorStateData.push({
          name: "WaterLeak",
          currentSensorState: currState
        });
      }
      // - FilterCleanliness
      if (device.mappings.FilterCleanliness) {
        devices[d.id].status = "SUCCESS";
        var currState = await utils.cached2Format(uid, device.mappings.FilterCleanliness, readings);
        devices[d.id].currentSensorStateData.push({
          name: "FilterCleanliness",
          currentSensorState: currState
        });
      }

      //EnergyStorage
      if (device.mappings.EnergyStorageExact || device.mappings.EnergyStorageDescriptive) {
        if (device.mappings.EnergyStorageDescriptive) {
          devices[d.id].descriptiveCapacityRemaining = await utils.cached2Format(uid, device.mappings.EnergyStorageDescriptive, readings);
        }
        var es;
        if (device.mappings.EnergyStoragePluggedIn) {
          devices[d.id].isPluggedIn = await utils.cached2Format(uid, device.mappings.EnergyStoragePluggedIn, readings);
        }
        if (device.mappings.EnergyStorageCharging) {
          devices[d.id].isCharging = await utils.cached2Format(uid, device.mappings.EnergyStorageCharging, readings);
        }
        if (device.mappings.EnergyStorageUntilFull) {
          devices[d.id].capacityUntilFull = [];
          device.mappings.EnergyStorageUntilFull.forEach(async (esuf) => {
            var rawValue = await utils.cached2Format(uid, esuf, readings);
            devices[d.id].capacityUntilFull.push({ "unit": esuf.unit, "rawValue": rawValue });
          });
        }
        if (device.mappings.EnergyStorageExact) {
          devices[d.id].capacityRemaining = [];
          device.mappings.EnergyStorageExact.forEach(async (ese) => {
            var rawValue = await utils.cached2Format(uid, ese, readings);
            devices[d.id].capacityRemaining.push({ "unit": ese.unit, "rawValue": rawValue });
          });
        }
        devices[d.id].status = "SUCCESS";
      }

      //MediaState
      if (device.mappings.MediaPlaybackState) {
        devices[d.id].playbackState = await utils.cached2Format(uid, device.mappings.MediaPlaybackState, readings);
      }
      if (device.mappings.MediaActivityState) {
        devices[d.id].activityState = await utils.cached2Format(uid, device.mappings.MediaActivityState, readings);
      }

      //InputSelector
      if (device.mappings.InputSelector && device.mappings.InputSelector.reading) {
        devices[d.id].currentInput = await utils.cached2Format(uid, device.mappings.InputSelector, readings);
        devices[d.id].status = "SUCCESS";
      }

      //NetworkControl
      if (device.mappings.NetworkEnabled) {
        devices[d.id].networkEnabled = await utils.cached2Format(uid, device.mappings.NetworkEnabled, readings);
        devices[d.id].status = "SUCCESS";
      }
      if (device.mappings.NetworkSettings) {
        devices[d.id].networkSettings = {};
        devices[d.id].networkSettings.ssid = await utils.cached2Format(uid, device.mappings.NetworkSettings, readings);
      }
      if (device.mappings.GuestNetwork) {
        devices[d.id].guestNetworkEnabled = await utils.cached2Format(uid, device.mappings.GuestNetwork, readings);
      }
      if (device.mappings.GuestNetworkSettings) {
        devices[d.id].guestNetworkSettings = {};
        devices[d.id].guestNetworkSettings.ssid = await utils.cached2Format(uid, device.mappings.GuestNetworkSettings, readings);
      }
      if (device.mappings.ConnectedDevices) {
        devices[d.id].numConnectedDevices = await utils.cached2Format(uid, device.mappings.ConnectedDevices, readings);
      }
      if (device.mappings.NetworkUsageMB) {
        devices[d.id].networkUsageMB = await utils.cached2Format(uid, device.mappings.NetworkUsageMB, readings);
        if (device.mappings.NetworkUsageLimitMB) {
          devices[d.id].networkUsageLimitMB = await utils.cached2Format(uid, device.mappings.NetworkUsageLimitMB, readings);
        } else {
          devices[d.id].networkUsageUnlimited = true;
        }
      }

      //action.devices.traits.Modes: STATES
      if (device.mappings.Modes) {
        devices[d.id].currentModeSettings = {};
        for (mode of device.mappings.Modes) {
          let currentMode = await utils.cached2Format(uid, mode, readings);
          devices[d.id].currentModeSettings[mode.mode_attributes.name] = currentMode;
        }
      }

      //action.devices.traits.Toggles
      if (device.mappings.Toggles) {
        devices[d.id].currentToggleSettings = {};
        for (toggle of device.mappings.Toggles) {
          if (toggle.reading) {
            let currentToggle = await utils.cached2Format(uid, toggle, readings);
            devices[d.id].currentToggleSettings[toggle.toggle_attributes.name] = currentToggle == toggle.valueOn;
          }
        }
      }

      //action.devices.traits.FanSpeed
      if (device.mappings.FanSpeed) {
        var rValue = await utils.cached2Format(uid, device.mappings.FanSpeed, readings);
        for (var fspeed in device.mappings.FanSpeed.speeds) {
          if (device.mappings.FanSpeed.speeds[fspeed].value === rValue) {
            devices[d.id].currentFanSpeedSetting = fspeed;
          }
        }
      }

      //action.devices.traits.LightEffects
      if (device.mappings.LightEffectsColorLoop || device.mappings.LightEffectsSleep || device.mappings.LightEffectsWake) {
        var cl = await utils.cached2Format(uid, device.mappings.LightEffectsColorLoop, readings);
        var sl = await utils.cached2Format(uid, device.mappings.LightEffectsSleep, readings);
        var wa = await utils.cached2Format(uid, device.mappings.LightEffectsWake, readings);
        var effect = "none";
        if (cl !== "none")
          effect = cl;
        if (sl !== "none")
          effect = sl;
        if (wa !== "none")
          effect = wa;

        if (effect === "none")
          devices[d.id].activeLightEffect = "";
        else
          devices[d.id].activeLightEffect = effect;
      }

      //action.devices.traits.Dock
      if (device.mappings.Dock) {
        devices[d.id].isDocked = await utils.cached2Format(uid, device.mappings.Dock, readings);
      }

      //Rotation
      if (device.mappings.RotationDegrees) {
        devices[d.id].rotationDegrees = await utils.cached2Format(uid, device.mappings.RotationDegrees, readings);
      }
      if (device.mappings.RotationPercent) {
        devices[d.id].RotationPercent = await utils.cached2Format(uid, device.mappings.RotationPercent, readings);
      }

      //Volume
      if (device.mappings.Volume && device.mappings.Volume.reading) {
        devices[d.id].currentVolume = await utils.cached2Format(uid, device.mappings.Volume, readings);
        if (device.mappings.Mute) {
          devices[d.id].isMuted = await utils.cached2Format(uid, device.mappings.Mute, readings);
        }
      }

      //action.devices.traits.ColorSetting
      if (device.mappings.RGB) {
        devices[d.id].color = {};
        const rgb = await utils.cached2Format(uid, device.mappings.RGB, readings);
        if (device.mappings.ColorMode) {
          const colormode = await utils.cached2Format(uid, device.mappings.ColorMode, readings);
          if (colormode == device.mappings.ColorMode.valueCt) {
            //color temperature mode
            devices[d.id].color.temperatureK = await utils.cached2Format(uid, device.mappings.ColorTemperature, readings);
          } else {
            //RGB mode
            if (reportstate) {
              devices[d.id].color.spectrumRGB = await utils.cached2Format(uid, device.mappings.RGB, readings);
            } else {
              devices[d.id].color.spectrumRgb = await utils.cached2Format(uid, device.mappings.RGB, readings);
            }
          }
        } else {
          //RGB mode
          if (reportstate) {
            devices[d.id].color.spectrumRGB = await utils.cached2Format(uid, device.mappings.RGB, readings);
          } else {
            devices[d.id].color.spectrumRgb = await utils.cached2Format(uid, device.mappings.RGB, readings);
          }
        }
      } else {
        if (device.mappings.Hue) {
          //TODO get current hue value
        }

        if (device.mappings.Saturation) {
          //TODO get current sat value
        }
      }

      //action.devices.traits.Brightness
      if (device.mappings.Brightness) {
        // Brightness range is 0..100
        devices[d.id].brightness = parseFloat(await utils.cached2Format(uid, device.mappings.Brightness, readings));
      }

      //action.devices.traits.StartStop
      if (device.mappings.StartStop) {
        devices[d.id].isPaused = await utils.cached2Format(uid, device.mappings.StartStop, readings) == 'paused' ? true : false;
        devices[d.id].isRunning = await utils.cached2Format(uid, device.mappings.StartStop, readings) == 'running' ? true : false;
      }
      if (device.mappings.StartStopZones && device.mappings.StartStopZones.reading) {
        devices[d.id].activeZones = await utils.cached2Format(uid, device.mappings.StartStopZones, readings);
        devices[d.id].activeZones = devices[d.id].activeZones.split(",");
      }

      //Exceptions (StatusReport)
      devices[d.id].currentStatusReport = [];
      if (device.mappings.Exceptions) {
        devices[d.id].status = 'SUCCESS';
        for (var exception_name in device.mappings.Exceptions) {
          //FIXME support exceptions for multiple responses
          if (device.mappings.Exceptions[exception_name].onlyLinkedInfo === false) {
            if (await utils.cached2Format(uid, device.mappings.Exceptions[exception_name], readings) === "EXCEPTION") {
              if (device.mappings.Exceptions[exception_name].blocking)
                devices[d.id].status = "EXCEPTIONS";
              devices[d.id].currentStatusReport.push({
                blocking: device.mappings.Exceptions[exception_name].blocking ? true : false,
                deviceTarget: d.id,
                priority: 0,
                statusCode: exception_name
              });
            }
          }
        }
      }

      //LinkedDevices (StatusReport)
      if (device.mappings.LinkedDevices) {
        if (!device.mappings.Exceptions)
          devices[d.id].status = 'SUCCESS';
        for (var ld of device.mappings.LinkedDevices.devices) {
          //devicename: ld.id
          //blocking: ld.blocking
          var linkedDevice = await utils.getDeviceAndReadings(uid, ld.id);
          //check for exceptions in linkedDevice
          if (linkedDevice.device.mappings.Exceptions) {
            for (var exception_name in linkedDevice.device.mappings.Exceptions) {
              if (await utils.cached2Format(uid, linkedDevice.device.mappings.Exceptions[exception_name], linkedDevice.readings) === "EXCEPTION") {
                if (ld.blocking)
                  devices[d.id].status = "EXCEPTIONS";
                devices[d.id].currentStatusReport.push({
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
      if (devices[d.id].currentStatusReport.length == 0) {
        delete devices[d.id].currentStatusReport;
      }

      //if a trait was used, set online, otherwise delete (e.g. scene)
      if (Object.keys(devices[d.id]).length) {
        devices[d.id].online = true;
      } else {
        delete devices[d.id];
      }
    } catch (err) {
      devices[d.id].errorCode = "functionNotSupported";
      devices[d.id].status = "ERROR";
      uiderror(uid, d.customData.device + ":" + err, err);
    }
  }
  uidlog(uid, 'processQUERY result: ' + JSON.stringify(devices));

  return {
    devices: devices
  };
} //processQUERY

module.exports = {
  handleQUERY,
  processQUERY
};