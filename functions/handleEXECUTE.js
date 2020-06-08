const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');
const settings = require('./settings.json');
var compareVersions = require('compare-versions');

const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;

async function handleEXECUTE(uid, reqId, res, input) {
  try {
    var payload = await processEXECUTE(uid, reqId, input);
    if (settings.CHECK_CLIENT_VERSION) {
      var clientVersion = await utils.getClientVersion(uid);
      if (clientVersion !== "0.0.1" && compareVersions(clientVersion, settings.MIN_CLIENT_VERSION) < 0) {
        uiderror(uid, 'CLIENT UPDATE NEEDED (sudo npm install -g gassistant-fhem --unsafe-perm)');
        if (input.context && input.context.locale_language === 'de') {
          uidlog(uid, 'CLIENT UPDATE NEEDED - VOICE');
          payload = {
            "errorCode": "needsSoftwareUpdate"
          };
        }
      }
    }
    var response = utils.createDirective(reqId, payload);
    uidlog(uid, 'response: ' + JSON.stringify(response));
    res.send(response);
  } catch (err) {
    uiderror(uid, err, err);
    res.send(utils.createDirective(reqId, {
      errorCode: 'hardError'
    }));
  }
}
module.exports.handleEXECUTE = handleEXECUTE;

async function processEXECUTE(uid, reqId, input) {

  // trait commands => https://developers.google.com/actions/smarthome/traits/
  const REQUEST_SET_BRIGHTNESSABSOLUTE = "action.devices.commands.BrightnessAbsolute";
  const REQUEST_SET_MODES = "action.devices.commands.SetModes";
  const REQUEST_ON_OFF = "action.devices.commands.OnOff";
  const REQUEST_SET_TARGET_TEMPERATURE = "action.devices.commands.ThermostatTemperatureSetpoint";
  const REQUEST_SET_THERMOSTAT_MODE = "action.devices.commands.ThermostatSetMode";
  const REQUEST_DOCK = "action.devices.commands.Dock";
  const REQUEST_LOCATE = "action.devices.commands.Locate";
  const REQUEST_STARTSTOP = "action.devices.commands.StartStop";
  const REQUEST_PAUSEUNPAUSE = "action.devices.commands.PauseUnpause";
  const REQUEST_FANSPEED = "action.devices.commands.SetFanSpeed";
  const REQUEST_FANSPEEDREVERSE = "action.devices.commands.Reverse";
  const REQUEST_COLORABSOLUTE = "action.devices.commands.ColorAbsolute";
  const REQUEST_SET_TOGGLES = "action.devices.commands.SetToggles";
  const REQUEST_ACTIVATE_SCENE = "action.devices.commands.ActivateScene";
  const REQUEST_OPENCLOSE = "action.devices.commands.OpenClose";
  const REQUEST_ARMDISARM = "action.devices.commands.ArmDisarm";
  const REQUEST_TIMERSTART = "action.devices.commands.TimerStart";
  const REQUEST_TIMERADJUST = "action.devices.commands.TimerAdjust";
  const REQUEST_TIMERPAUSE = "action.devices.commands.TimerPause";
  const REQUEST_TIMERRESUME = "action.devices.commands.TimerResume";
  const REQUEST_TIMERCANCEL = "action.devices.commands.TimerCancel";
  const REQUEST_SET_TEMPERATURE = "action.devices.commands.SetTemperature";
  const REQUEST_GET_CAMERASTREAM = "action.devices.commands.GetCameraStream";
  const REQUEST_EFFECT_COLORLOOP = "action.devices.commands.ColorLoop";
  const REQUEST_EFFECT_STOP = "action.devices.commands.StopEffect";
  const REQUEST_SET_HUMIDITY = "action.devices.commands.SetHumidity";
  const REQUEST_SET_HUMIDITY_RELATIVE = "action.devices.commands.HumidityRelative";
  const REQUEST_SET_LOCKUNLOCK = "action.devices.commands.LockUnlock";
  const REQUEST_SOFTWARE_UPDATE = "action.devices.commands.SoftwareUpdate";
  const REQUEST_REBOOT = "action.devices.commands.Reboot";
  const REQUEST_EFFECT_SLEEP = "action.devices.commands.Sleep";
  const REQUEST_EFFECT_WAKE = "action.devices.commands.Wake";
  const REQUEST_CHARGE = "action.devices.commands.Charge";
  const REQUEST_ROTATE_ABSOLUTE = "action.devices.commands.RotateAbsolute";
  const REQUEST_MUTE = "action.devices.commands.mute";
  const REQUEST_SET_VOLUME = "action.devices.commands.setVolume";
  const REQUEST_SET_VOLUME_RELATIVE = "action.devices.commands.volumeRelative";
  const REQUEST_MEDIA_CAPTION_ON = "action.devices.commands.mediaClosedCaptioningOn";
  const REQUEST_MEDIA_CAPTION_OFF = "action.devices.commands.mediaClosedCaptioningOff";
  const REQUEST_MEDIA_NEXT = "action.devices.commands.mediaNext";
  const REQUEST_MEDIA_PAUSE = "action.devices.commands.mediaPause";
  const REQUEST_MEDIA_PREVIOUS = "action.devices.commands.mediaPrevious";
  const REQUEST_MEDIA_RESUME = "action.devices.commands.mediaResume";
  const REQUEST_MEDIA_REPEAT_MODE = "action.devices.commands.mediaRepeatMode";
  const REQUEST_MEDIA_SEEK_RELATIVE = "action.devices.commands.mediaSeekRelative";
  const REQUEST_MEDIA_SEEK_TO_POS = "action.devices.commands.mediaSeekToPosition";
  const REQUEST_MEDIA_SHUFFLE = "action.devices.commands.mediaShuffle";
  const REQUEST_MEDIA_STOP = "action.devices.commands.mediaStop";
  const REQUEST_SET_INPUT = "action.devices.commands.SetInput";
  const REQUEST_ENABLE_DISABLE_GUEST_NW = "action.devices.commands.EnableDisableGuestNetwork";
  const REQUEST_ENABLE_DISABLE_NW_PROFILE = "action.devices.commands.EnableDisableNetworkProfile";
  const REQUEST_GET_GUEST_NW_PWD = "action.devices.commands.GetGuestNetworkPassword";
  const REQUEST_TEST_NW_SPEED = "action.devices.commands.TestNetworkSpeed";


  //map commands to the mapping within the device
  const commandMapping = {};
  commandMapping[REQUEST_MUTE] = ['Mute'];
  commandMapping[REQUEST_SET_VOLUME] = ['Volume'];
  commandMapping[REQUEST_SET_VOLUME_RELATIVE] = ['Volume'];
  commandMapping[REQUEST_SET_BRIGHTNESSABSOLUTE] = ['Brightness'];
  commandMapping[REQUEST_SET_MODES] = ['Modes'];
  commandMapping[REQUEST_ON_OFF] = ['On'];
  commandMapping[REQUEST_SET_TARGET_TEMPERATURE] = ['TargetTemperature'];
  commandMapping[REQUEST_SET_THERMOSTAT_MODE] = ['ThermostatModes'];
  commandMapping[REQUEST_DOCK] = ['Dock'];
  commandMapping[REQUEST_LOCATE] = ['Locate'];
  commandMapping[REQUEST_STARTSTOP] = ['StartStop'];
  commandMapping[REQUEST_PAUSEUNPAUSE] = ['StartStop'];
  commandMapping[REQUEST_FANSPEED] = ['FanSpeed'];
  commandMapping[REQUEST_FANSPEEDREVERSE] = ['FanSpeed'];
  commandMapping[REQUEST_COLORABSOLUTE] = ['RGB', 'ColorTemperature'];
  commandMapping[REQUEST_SET_TOGGLES] = ['Toggles'];
  commandMapping[REQUEST_ACTIVATE_SCENE] = ['Scene'];
  commandMapping[REQUEST_OPENCLOSE] = ['OpenClose'];
  commandMapping[REQUEST_ARMDISARM] = ['ArmDisarm'];
  commandMapping[REQUEST_TIMERSTART] = ['Timer'];
  commandMapping[REQUEST_TIMERADJUST] = ['Timer'];
  commandMapping[REQUEST_TIMERPAUSE] = ['Timer'];
  commandMapping[REQUEST_TIMERRESUME] = ['Timer'];
  commandMapping[REQUEST_TIMERCANCEL] = ['Timer'];
  commandMapping[REQUEST_SET_TEMPERATURE] = ['TemperatureControlSetCelsius'];
  commandMapping[REQUEST_GET_CAMERASTREAM] = ['CameraStream'];
  commandMapping[REQUEST_EFFECT_COLORLOOP] = ['LightEffectsColorLoop'];
  commandMapping[REQUEST_EFFECT_STOP] = ['LightEffectsColorLoop'];
  commandMapping[REQUEST_SET_HUMIDITY] = ['TargetRelativeHumidity'];
  commandMapping[REQUEST_SET_HUMIDITY_RELATIVE] = ['TargetRelativeHumidity'];
  commandMapping[REQUEST_SET_LOCKUNLOCK] = ['LockTargetState'];
  commandMapping[REQUEST_SOFTWARE_UPDATE] = ['SoftwareUpdate'];
  commandMapping[REQUEST_REBOOT] = ['Reboot'];
  commandMapping[REQUEST_EFFECT_SLEEP] = ['LightEffectsSleep'];
  commandMapping[REQUEST_EFFECT_WAKE] = ['LightEffectsWake'];
  commandMapping[REQUEST_CHARGE] = ['EnergyStorageExact', 'EnergyStorageDescriptive'];
  commandMapping[REQUEST_ROTATE_ABSOLUTE] = ['RotationDegrees', 'RotationPercent'];
  commandMapping[REQUEST_MEDIA_CAPTION_ON] = ["mediaClosedCaptioningOn"];
  commandMapping[REQUEST_MEDIA_CAPTION_OFF] = ["mediaClosedCaptioningOff"];
  commandMapping[REQUEST_MEDIA_NEXT] = ["mediaNext"];
  commandMapping[REQUEST_MEDIA_PAUSE] = ["mediaPause"];
  commandMapping[REQUEST_MEDIA_PREVIOUS] = ["mediaPrevious"];
  commandMapping[REQUEST_MEDIA_RESUME] = ["mediaResume"];
  commandMapping[REQUEST_MEDIA_REPEAT_MODE] = ["mediaRepeatMode"];
  commandMapping[REQUEST_MEDIA_SEEK_RELATIVE] = ["mediaSeekRelative"];
  commandMapping[REQUEST_MEDIA_SEEK_TO_POS] = ["mediaSeekToPosition"];
  commandMapping[REQUEST_MEDIA_SHUFFLE] = ["mediaShuffle"];
  commandMapping[REQUEST_MEDIA_STOP] = ["mediaStop"];
  commandMapping[REQUEST_SET_INPUT] = ["InputSelector"];
  commandMapping[REQUEST_ENABLE_DISABLE_GUEST_NW] = ["GuestNetwork"];
  commandMapping[REQUEST_ENABLE_DISABLE_NW_PROFILE] = ["NetworkProfile"];
  commandMapping[REQUEST_GET_GUEST_NW_PWD] = ["GuestNetworkPassword"];
  commandMapping[REQUEST_TEST_NW_SPEED] = ["TestNetworkSpeed"];

  let responses = [];
  let fhemExecCmd = [];
  let allDevices;
  var device = {};
  var readings = {};

  for (cmd of input.payload.commands) {
    for (exec of cmd.execution) {
      allDevices = await utils.getAllDevicesAndReadings(uid);

      for (d of cmd.devices) {
        if (allDevices && allDevices[d.customData.device]) {
          device = allDevices[d.customData.device].device;
          readings = allDevices[d.customData.device].readings;
        } else {
          var dr = await utils.getDeviceAndReadings(uid, d.customData.device);
          device = dr.device;
          readings = dr.readings;
        }

        if (Object.keys(device).length === 0) {
          uiderror(uid, "Device " + d.customData.device + " not found, try reload.");
          return {
            errorCode: 'deviceNotFound'
          };
        }

        const requestedName = exec.command;

        //check PIN
        if (!commandMapping[requestedName]) {
          uiderror(uid, 'Command ' + requestedName + ' not configured in commandMappings for device ' + d.customData.device);
          return { errorCode: 'functionNotSupported' };
        }

        var pinMapping = undefined;
        for (var m in commandMapping[requestedName]) {
          if (device.mappings[commandMapping[requestedName][m]]) {
            pinMapping = commandMapping[requestedName][m];
          }
        }
        if (!pinMapping) {
          uiderror(uid, 'Command ' + requestedName + ' not configured for device ' + d.customData.device);
          return {
            errorCode: 'functionNotSupported'
          };
        }

        if (device.mappings[pinMapping].pin) {
          if (!exec.challenge || !exec.challenge.pin) {
            //pin required
            responses.push({
              "ids": [device.uuid_base],
              "status": "ERROR",
              "errorCode": "challengeNeeded",
              "challengeNeeded": {
                "type": "pinNeeded"
              }
            });
            continue;
          } else {
            if (!exec.challenge || exec.challenge.pin !== device.mappings[pinMapping].pin) {
              //incorrect pin
              responses.push({
                "ids": [device.uuid_base],
                "status": "ERROR",
                "errorCode": "challengeNeeded",
                "challengeNeeded": {
                  "type": "challengeFailedPinNeeded"
                }
              });
              continue;
            }

            //correct pin
          }
        }

        //this is required for Hue Devices with SonOff switches, it allows users to say "dim to 100%" when light is off
        if (device.mappings.On && device.mappings.On.device !== device.name && requestedName !== REQUEST_ON_OFF && device.mappings.On.delayAfter) {
          //prevent error check if there is another device which activates the device (e.g. shelly + Hue)
          if (!allDevices[device.mappings.On.device].readings || await utils.cached2Format(uid, device.mappings.On, allDevices[device.mappings.On.device].readings) === false) {
            //only if device is OFF
            response = await processEXECUTEOnOff(uid, reqId, device, 1, fhemExecCmd);
            responses.push(...response);
          }
        } else {
          if (requestedName !== REQUEST_ON_OFF || (requestedName === REQUEST_ON_OFF && device.mappings.On.device === device.name)) {
            //Errors check
            if (device.mappings.Errors) {
              var errFound = false;
              for (var er in device.mappings.Errors) {
                const errCheck = await utils.cached2Format(uid, device.mappings.Errors[er], readings);
                if (errCheck === "ERROR") {
                  responses.push({
                    ids: [device.uuid_base],
                    status: 'ERROR',
                    errorCode: er
                  });
                  errFound = true;
                }
              }
              if (errFound) {
                continue;
              }
            }
          }
        }

        switch (requestedName) {

          case REQUEST_ON_OFF:
            response = await processEXECUTEOnOff(uid, reqId, device, exec.params.on ? 1 : 0, fhemExecCmd);
            break;

          case REQUEST_SET_BRIGHTNESSABSOLUTE:
            response = await processEXECUTEBrightnessAbsolute(uid, reqId, device, exec.params.brightness, fhemExecCmd);
            break;

          case REQUEST_EFFECT_COLORLOOP:
            response = await processEXECUTESetEffectColorLoop(uid, reqId, device, fhemExecCmd);
            break;

          case REQUEST_EFFECT_SLEEP:
            response = await processEXECUTESetEffectSleep(uid, reqId, device, exec.params, fhemExecCmd);
            break;

          case REQUEST_EFFECT_WAKE:
            response = await processEXECUTESetEffectWake(uid, reqId, device, exec.params, fhemExecCmd);
            break;

          case REQUEST_EFFECT_STOP:
            response = await processEXECUTESetEffectStop(uid, reqId, device, fhemExecCmd);
            break;

          case REQUEST_SET_TARGET_TEMPERATURE:
            response = await processEXECUTESetTargetTemperature(uid, reqId, device, exec.params.thermostatTemperatureSetpoint, fhemExecCmd);
            break;

          case REQUEST_SET_THERMOSTAT_MODE:
            response = await processEXECUTESetThermostatMode(uid, reqId, device, exec.params.thermostatMode, fhemExecCmd);
            break;

          case REQUEST_DOCK:
            response = await processEXECUTEDock(uid, reqId, device, fhemExecCmd);
            break;

          case REQUEST_LOCATE:
            response = await processEXECUTELocate(uid, reqId, device, fhemExecCmd);
            break;

          case REQUEST_STARTSTOP:
            response = await processEXECUTEStartStop(uid, reqId, device, exec.params, fhemExecCmd);
            break;

          case REQUEST_PAUSEUNPAUSE:
            response = await processEXECUTEPauseUnpause(uid, reqId, device, exec.params.pause ? 1 : 0, fhemExecCmd);
            break;

          case REQUEST_FANSPEED:
            response = await processEXECUTESetFanSpeed(uid, reqId, device, exec.params.fanSpeed, fhemExecCmd);
            break;

          case REQUEST_COLORABSOLUTE:
            response = await processEXECUTESetColorAbsolute(uid, reqId, device, exec.params.color, fhemExecCmd);
            break;

          case REQUEST_SET_TOGGLES:
            response = await processEXECUTESetToggles(uid, reqId, device, exec.params.updateToggleSettings, fhemExecCmd);
            break;

          case REQUEST_ACTIVATE_SCENE:
            response = await processEXECUTEActivateScene(uid, reqId, device, d.customData.scenename, exec.params.deactivate, fhemExecCmd);
            break;

          case REQUEST_FANSPEEDREVERSE:
            //response = await processEXECUTEReverse(uid, reqId,exec.params.reverse));
            break;

          case REQUEST_CHARGE:
            response = await processEXECUTESetCharge(uid, reqId, device, readings, exec, fhemExecCmd);
            break;

          case REQUEST_ROTATE_ABSOLUTE:
            response = await processEXECUTERotationAbsolute(uid, reqId, device, readings, exec, fhemExecCmd);
            break;

          //action.devices.traits.Modes: COMMANDS
          case REQUEST_SET_MODES:
            response = await processEXECUTESetModes(uid, reqId, device, exec, fhemExecCmd);
            break;

          case REQUEST_OPENCLOSE:
            response = await processEXECUTESetOpenClose(uid, reqId, device, exec.params, fhemExecCmd);
            break;

          case REQUEST_ARMDISARM:
            response = await processEXECUTEArmDisarm(uid, reqId, device, exec.params, fhemExecCmd);
            break;

          case REQUEST_TIMERSTART:
            response = await processEXECUTETimerStart(uid, reqId, device, exec.params, fhemExecCmd);
            break;

          case REQUEST_TIMERCANCEL:
            response = await processEXECUTETimerCancel(uid, reqId, device, exec.params, fhemExecCmd);
            break;

          case REQUEST_SET_TEMPERATURE:
            response = await processEXECUTESetTempearture(uid, reqId, device, exec.params.temperature, fhemExecCmd);
            break;

          case REQUEST_GET_CAMERASTREAM:
            response = await processEXECUTEGetCameraStream(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_SET_HUMIDITY:
            response = await processEXECUTESetHumidity(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_SET_HUMIDITY_RELATIVE:
            response = await processEXECUTESetHumidityRelative(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_SET_LOCKUNLOCK:
            response = await processEXECUTESetLockUnlock(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_SOFTWARE_UPDATE:
            response = await processEXECUTESoftwareUpdate(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_REBOOT:
            response = await processEXECUTEReboot(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_SET_INPUT:
            response = await processEXECUTESetInput(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_MUTE:
            response = await processEXECUTEMute(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_SET_VOLUME:
            response = await processEXECUTESetVolume(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_SET_VOLUME_RELATIVE:
            response = await processEXECUTESetVolumeRelative(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          //NetworkControl
          case REQUEST_ENABLE_DISABLE_GUEST_NW:
            response = await processEXECUTEEnableDisableGuestNetwork(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;
          case REQUEST_ENABLE_DISABLE_NW_PROFILE:
            response = await processEXECUTEEnableDisableNetworkProfile(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;
          case REQUEST_GET_GUEST_NW_PWD:
            response = await processEXECUTEGetGuestNetworkPassword(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;
          case REQUEST_TEST_NW_SPEED:
            response = await processEXECUTETestNetworkSpeed(uid, reqId, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_MEDIA_NEXT:
          case REQUEST_MEDIA_CAPTION_OFF:
          case REQUEST_MEDIA_PAUSE:
          case REQUEST_MEDIA_PREVIOUS:
          case REQUEST_MEDIA_RESUME:
          case REQUEST_MEDIA_STOP:
          case REQUEST_MEDIA_SHUFFLE:
            response = await processEXECUTESetTransportControlNoParams(uid, reqId, requestedName, device, readings, exec.params, fhemExecCmd);
            break;

          case REQUEST_MEDIA_REPEAT_MODE:

          case REQUEST_MEDIA_SEEK_RELATIVE:

          case REQUEST_MEDIA_SEEK_TO_POS:

          case REQUEST_MEDIA_CAPTION_ON:

          default:
            //return unsupported operation
            uiderror(uid, "Unsupported operation" + requestedName);
            response = [{
              ids: [device.uuid_base],
              status: 'ERROR',
              errorCode: 'functionNotSupported'
            }];
        } // switch

        await utils.checkExceptions(uid, device, readings, response);
        //check LinkedDevices
        var checkLDRes = await utils.checkLinkedDevices(uid, device);
        if (checkLDRes.report.length)
          response.currentStatusReport = checkLDRes.report;

        responses.push(...response);
      }
    }
  }

  //send to FHEM
  var fcmds = {};
  for (var c of fhemExecCmd) {
    fcmds[c.connection] = fcmds[c.connection] ? fcmds[c.connection] + ';' + c.cmd : c.cmd;
  }
  utils.sendCmd2Fhem(uid, fcmds);

  //create response payload
  return {
    commands: responses
  };
}; // processEXECUTE
module.exports.processEXECUTE = processEXECUTE;

async function processEXECUTEOnOff(uid, reqId, device, state, fhemExecCmd) {
  if (!device.mappings.On) {
    return [{
      errorCode: 'notSupported'
    }];
  }

  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.On, state));

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      on: true,
      online: true
    }
  });

  return res;
} // processEXECUTEOnOff
module.exports.processEXECUTEOnOff = processEXECUTEOnOff;

async function processEXECUTEEnableDisableGuestNetwork(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.GuestNetwork, params.enable));

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      guestNetworkEnabled: params.enable
    }
  });

  return res;
} // processEXECUTEEnableDisableGuestNetwork
module.exports.processEXECUTEEnableDisableGuestNetwork = processEXECUTEEnableDisableGuestNetwork;

async function processEXECUTEEnableDisableNetworkProfile(uid, reqId, device, readings, params, fhemExecCmd) {
  params.enable = params.enable ? "on" : "off";
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.NetworkProfile, params.profile + "-" + params.enable));

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
    }
  });

  return res;
} // processEXECUTEEnableDisableNetworkProfile
module.exports.processEXECUTEEnableDisableNetworkProfile = processEXECUTEEnableDisableNetworkProfile;

async function processEXECUTEGetGuestNetworkPassword(uid, reqId, device, readings, params, fhemExecCmd) {
  let res = [];
  let pass = await utils.cached2Format(uid, device.mappings.guestNetworkPassword, readings);

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      guestNetworkPassword: pass
    }
  });

  return res;
}
module.exports.processEXECUTEGetGuestNetworkPassword = processEXECUTEGetGuestNetworkPassword;

async function processEXECUTETestNetworkSpeed(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.TestNetworkSpeed, ''));

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'PENDING'
  });

  return res;
}
module.exports.processEXECUTETestNetworkSpeed = processEXECUTETestNetworkSpeed;

async function processEXECUTESetEffectColorLoop(uid, reqId, device, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.LightEffects, "colorLoop"));

  let res = [];
  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      on: true,
      activeLightEffect: 'colorLoop'
    }
  });
  return res;
} // processEXECUTESetEffectColorLoop
module.exports.processEXECUTESetEffectColorLoop = processEXECUTESetEffectColorLoop;

async function processEXECUTESetEffectSleep(uid, reqId, device, params, fhemExecCmd) {
  var duration = '';
  if (params.duration)
    duration = params.duration;

  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.LightEffectsSleep, duration));

  let res = [];
  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      on: true,
      activeLightEffect: 'sleep'
    }
  });
  return res;
} // processEXECUTESetEffectSleep
module.exports.processEXECUTESetEffectSleep = processEXECUTESetEffectSleep;

async function processEXECUTESetEffectWake(uid, reqId, device, params, fhemExecCmd) {
  var duration = '';
  if (params.duration)
    duration = params.duration;
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.LightEffectsWake, duration));

  let res = [];
  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      on: true,
      activeLightEffect: 'wake'
    }
  });
  return res;
} // processEXECUTESetEffectWake
module.exports.processEXECUTESetEffectWake = processEXECUTESetEffectWake;

async function processEXECUTESetEffectStop(uid, reqId, device, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.LightEffectsColorLoop, "none"));

  let res = [];
  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      on: true,
      activeLightEffect: ''
    }
  });
  return res;
} // processEXECUTESetEffectStop
module.exports.processEXECUTESetEffectStop = processEXECUTESetEffectStop;

async function processEXECUTEGetCameraStream(uid, reqId, device, readings, params, fhemExecCmd) {
  let res = [];
  var streamUrl = await utils.cached2Format(uid, device.mappings.CameraStream, readings);
  var stateRes = {
    cameraStreamAccessUrl: streamUrl
  }

  if (device.mappings.CameraStream.authToken) {
    stateRes.cameraStreamAuthToken = device.mappings.CameraStream.authToken;
  }

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: stateRes
  });

  return res;
} // processEXECUTEGetCameraStream
module.exports.processEXECUTEGetCameraStream = processEXECUTEGetCameraStream;

async function processEXECUTEArmDisarm(uid, reqId, device, params, fhemExecCmd) {
  var arm = false;
  if (params.arm) {
    if (params.cancel) {
      fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.ArmDisarm, device.mappings.ArmDisarm.cmdCancel));
    } else {
      arm = true;
      fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.ArmDisarm, device.mappings.ArmDisarm.cmdArm));
    }
  } else {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.ArmDisarm, device.mappings.ArmDisarm.cmdDisarm));
  }

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      isArmed: arm,
      exitAllowance: parseInt(device.mappings.ArmDisarm.exitAllowance)
    }
  });

  return res;
} // processEXECUTEArmDisarm
module.exports.processEXECUTEArmDisarm = processEXECUTEArmDisarm;

async function processEXECUTETimerStart(uid, reqId, device, params, fhemExecCmd) {
  if (device.mappings.Timer.cmdTimerStart) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Timer, device.mappings.Timer.cmdTimerStart + ' ' + params.timerTimeSec));
  } else {
    return [{
      ids: [device.uuid_base],
      status: 'ERROR',
      errorCode: 'functionNotSupported'
    }];
  }

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      timerRemainingSec: params.timerTimeSec
    }
  });

  return res;
} // processEXECUTETimerStart
module.exports.processEXECUTETimerStart = processEXECUTETimerStart;

async function processEXECUTETimerCancel(uid, reqId, device, params, fhemExecCmd) {
  if (device.mappings.Timer.cmdTimerCancel) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Timer, device.mappings.Timer.cmdTimerCancel));
  } else {
    return [{
      ids: [device.uuid_base],
      status: 'ERROR',
      errorCode: 'functionNotSupported'
    }];
  }

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      timerRemainingSec: 0
    }
  });

  return res;
} // processEXECUTETimerCancel
module.exports.processEXECUTETimerCancel = processEXECUTETimerCancel;

async function processEXECUTESetOpenClose(uid, reqId, device, params, fhemExecCmd) {
  if (device.mappings.TargetPosition && params.openPercent !== 0 && params.openPercent !== 100) {
    //TargetPosition supported
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.TargetPosition, params.openPercent));
  } else {
    //only up/down supported
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.OpenClose, params.openPercent));
  }

  let res = [];

  res.push({
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      openPercent: params.openPercent,
      online: true
    }
  });

  return res;
} // processEXECUTESetOpenClose
module.exports.processEXECUTESetOpenClose = processEXECUTESetOpenClose;

async function processEXECUTEBrightnessAbsolute(uid, reqId, device, brightness, fhemExecCmd) {
  let mapping;
  if (device.mappings.Brightness)
    mapping = device.mappings.Brightness;
  else if (device.mappings.TargetPosition)
    mapping = device.mappings.TargetPosition;
  else
    return [];

  let target = brightness;
  if (mapping.minValue && target < mapping.minValue)
    target = mapping.minValue;
  else if (mapping.maxValue && target > mapping.maxValue)
    target = mapping.maxValue;

  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, mapping, parseInt(target)));

  return [{
    ids: [device.uuid_base],
    status: 'SUCCESS',
    states: {
      brightness: brightness
    }
  }];
}; // processEXECUTEBrightnessAbsolute
module.exports.processEXECUTEBrightnessAbsolute = processEXECUTEBrightnessAbsolute;

async function processEXECUTESetTargetTemperature(uid, reqId, device, targetTemperature, fhemExecCmd) {
  let min = parseFloat(device.mappings.TargetTemperature.minValue);
  if (min === undefined) min = 15.0;
  let max = parseFloat(device.mappings.TargetTemperature.maxValue);
  if (max === undefined) max = 30.0;

  if (targetTemperature < min || targetTemperature > max)
    return [{
      ids: [device.uuid_base],
      status: 'ERROR',
      errorCode: 'valueOutOfRange'
    }];

  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.TargetTemperature, targetTemperature));

  return [{
    states: {
      thermostatTemperatureSetpoint: targetTemperature
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; // processEXECUTESetTargetTemperature
module.exports.processEXECUTESetTargetTemperature = processEXECUTESetTargetTemperature;

async function processEXECUTESetTempearture(uid, reqId, device, temperature, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.TemperatureControlSetCelsius, temperature));

  return [{
    states: {
      temperatureSetpointCelsius: temperature
      //FIXME temperatureAmbientCelsius: 0
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetTempearture
module.exports.processEXECUTESetTempearture = processEXECUTESetTempearture;

async function processEXECUTEMute(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Mute, params.mute));

  return [{
    states: {
      isMute: params.mute
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTEMute
module.exports.processEXECUTEMute = processEXECUTEMute;

async function processEXECUTESetTransportControlNoParams(uid, reqId, command, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings[command.replace("action.devices.commands.", "")]));

  return [{
    states: {
      online: "online"
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetTransportControlNoParams
module.exports.processEXECUTESetTransportControlNoParams = processEXECUTESetTransportControlNoParams;

async function processEXECUTESetInput(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.InputSelector, params.newInput));

  return [{
    states: {
      currentInput: params.newInput
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetInput
module.exports.processEXECUTESetInput = processEXECUTESetInput;

async function processEXECUTESetVolume(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Volume, params.volumeLevel));

  return [{
    states: {
      currentVolume: params.volumeLevel
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetVolume
module.exports.processEXECUTESetVolume = processEXECUTESetVolume;

async function processEXECUTESetVolumeRelative(uid, reqId, device, readings, params, fhemExecCmd) {
  var currVolume = 0;
  var newVolume = 0;
  if (device.mappings.Volume.levelStepSize)
      params.relativeSteps = params.relativeSteps < 0 ? -device.mappings.Volume.levelStepSize : device.mappings.Volume.levelStepSize;

  if (device.mappings.Volume.reading) {
    currVolume = await utils.cached2Format(uid, device.mappings.Volume, readings);
    newVolume = currVolume + params.relativeSteps;
  } else {
    newVolume = params.relativeSteps;
  }
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Volume, newVolume));

  return [{
    states: {
      online: true
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetVolumeRelative
module.exports.processEXECUTESetVolumeRelative = processEXECUTESetVolumeRelative;

async function processEXECUTESetHumidity(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.TargetRelativeHumidity, params.humidity));

  return [{
    states: {
      humiditySetpointPercent: params.humidity
      //FIXME humidityAmbientPercent: 0
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetHumidity
module.exports.processEXECUTESetHumidity = processEXECUTESetHumidity;

async function processEXECUTESetHumidityRelative(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.TargetRelativeHumidity, params.humidity));

  return [{
    states: {
      humiditySetpointPercent: params.humidity
      //FIXME humidityAmbientPercent: 0
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetHumidityRelative
module.exports.processEXECUTESetHumidityRelative = processEXECUTESetHumidityRelative;

async function processEXECUTESetLockUnlock(uid, reqId, device, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.LockTargetState, params.lock));

  return [{
    states: {
      isLocked: params.lock
      //FIXME isJammed: 0
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESetLockUnlock
module.exports.processEXECUTESetLockUnlock = processEXECUTESetLockUnlock;

async function processEXECUTESoftwareUpdate(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.SoftwareUpdate, ''));

  return [{
    states: {},
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTESoftwareUpdate
module.exports.processEXECUTESoftwareUpdate = processEXECUTESoftwareUpdate;

async function processEXECUTEReboot(uid, reqId, device, readings, params, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Reboot, ''));

  return [{
    states: {},
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTEReboot
module.exports.processEXECUTEReboot = processEXECUTEReboot;

async function processEXECUTESetThermostatMode(uid, reqId, device, thermostatMode, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.ThermostatModes, thermostatMode));

  return [{
    states: {
      thermostatMode: thermostatMode
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
};
module.exports.processEXECUTESetThermostatMode = processEXECUTESetThermostatMode;

async function processEXECUTEDock(uid, reqId, device, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Dock, ''));

  return [{
    states: {
      isDocked: true
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTEDock
module.exports.processEXECUTEDock = processEXECUTEDock;

async function processEXECUTELocate(uid, reqId, device, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Locate, ''));

  return [{
    states: {
      generatedAlert: true
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTELocate
module.exports.processEXECUTELocate = processEXECUTELocate;

async function processEXECUTEStartStop(uid, reqId, device, params, fhemExecCmd) {
  if (params.zone) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.StartStopZones, params.zone));
  } else {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.StartStop, params.start));
  }

  return [{
    states: {
      isRunning: params.start
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTEStartStop
module.exports.processEXECUTEStartStop = processEXECUTEStartStop;

async function processEXECUTEPauseUnpause(uid, reqId, device, pause, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.StartStop, pause, 'PauseUnpause'));

  return [{
    states: {
      isPaused: pause
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTEPauseUnpause
module.exports.processEXECUTEPauseUnpause = processEXECUTEPauseUnpause;

async function processEXECUTESetFanSpeed(uid, reqId, device, speedname, fhemExecCmd) {
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.FanSpeed, device.mappings.FanSpeed.speeds[speedname].cmd));

  return [{
    states: {
      currentFanSpeedSetting: speedname
    },
    status: 'success',
    ids: [device.uuid_base]
  }];
}; //processEXECUTEPauseUnpause
module.exports.processEXECUTESetFanSpeed = processEXECUTESetFanSpeed;

async function processEXECUTESetColorAbsolute(uid, reqId, device, color, fhemExecCmd) {
  let ret = [];

  if (color.spectrumRGB) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.RGB, color.spectrumRGB));
    ret.push({
      states: {
        color: {
          spectrumRgb: color.spectrumRGB
        }
      },
      ids: [device.uuid_base],
      status: "SUCCESS",
      online: "true"
    });
  } else if (color.spectrumHSV) {
    //Hue
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Hue, color.spectrumHSV.hue));
    //Brightness
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.HSVBrightness, color.spectrumHSV.value));
    //Saturation
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Saturation, color.spectrumHSV.saturation));
    ret.push({
      states: {
        color: {
          spectrumHsv: {
            hue: color.spectrumHSV.hue,
            saturation: color.spectrumHSV.saturation,
            value: color.spectrumHSV.value
          }
        }
      },
      ids: [device.uuid_base],
      status: "SUCCESS",
      online: "true"
    });
  } else if (color.temperature) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.ColorTemperature, color.temperature));
    ret.push({
      states: {
        color: {
          temperatureK: color.temperature
        }
      },
      ids: [device.uuid_base],
      status: "SUCCESS",
      online: "true"
    });
  }

  return ret;
}; // processEXECUTESetColorAbsolute
module.exports.processEXECUTESetColorAbsolute = processEXECUTESetColorAbsolute;

async function processEXECUTESetToggles(uid, reqId, device, toggleSettings, fhemExecCmd) {
  let retArr = [];

  for (toggle of Object.keys(toggleSettings)) {
    let value = toggleSettings[toggle];
    for (mappingToggle of device.mappings.Toggles) {
      if (mappingToggle.toggle_attributes.name == toggle) {
        fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, mappingToggle, value));

        let ret = {
          states: {
            currentToggleSettings: {}
          },
          status: 'SUCCESS',
          ids: [device.uuid_base]
        };
        ret.states.currentToggleSettings[toggle] = value;
        retArr.push(ret);
      }
    }
  }

  return retArr;
} //processEXECUTESetToggles
module.exports.processEXECUTESetToggles = processEXECUTESetToggles;

async function processEXECUTEActivateScene(uid, reqId, device, scenename, deactivate, fhemExecCmd) {
  for (s of device.mappings.Scene) {
    if (s.scenename == scenename) {
      fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, s, deactivate ? 0 : 1));
    }
  }

  return [{
    states: {},
    status: 'success',
    ids: [device.uuid_base.replace(/[^\w_\-=#;:?@&]/g, '_') + '-' + scenename]
  }];
}; //processEXECUTEActivateScene
module.exports.processEXECUTEActivateScene = processEXECUTEActivateScene;

async function processEXECUTESetCharge(uid, reqId, device, readings, event, fhemExecCmd) {
  var es;
  if (device.mappings.EnergyStorageExact) {
    es = device.mappings.EnergyStorageExact[0];
  } else {
    es = device.mappings.EnergyStorageDescriptive;
  }
  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, es, event.params.charge ? "START" : "STOP", fhemExecCmd));

  var isPluggedValue = false;
  if (device.mappings.EnergyStoragePluggedIn)
    isPluggedValue = await utils.cached2Format(uid, device.mappings.EnergyStoragePluggedIn, readings);

  var isChargingValue = false;
  if (device.mappings.EnergyStorageCharging)
    isChargingValue = await utils.cached2Format(uid, device.mappings.EnergyStorageCharging, readings);

  return [{
    ids: [device.uuid_base],
    status: "SUCCESS",
    states: {
      online: true,
      isPluggedIn: isPluggedValue,
      isCharging: isChargingValue
    }
  }];
} //processEXECUTESetCharge
module.exports.processEXECUTESetCharge = processEXECUTESetCharge;

async function processEXECUTERotationAbsolute(uid, reqId, device, readings, event, fhemExecCmd) {
  var ret = [{
    ids: [device.uuid_base],
    status: "SUCCESS",
    states: {
      online: true
    }
  }]
  if (event.params.rotationDegrees) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.RotationDegrees, event.params.rotationDegrees, fhemExecCmd));
    ret[0].states.rotationDegrees = event.params.rotationDegrees;
  } else {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.RotationPercent, event.params.rotationPercent, fhemExecCmd));
    ret[0].states.rotationPercent = event.params.rotationPercent;
  }

  return ret;
} //processEXECUTERotationAbsolute
module.exports.processEXECUTERotationAbsolute = processEXECUTERotationAbsolute;

async function processEXECUTESetModes(uid, reqId, device, event, fhemExecCmd) {
  let retArr = [];
  for (mode of Object.keys(event.params.updateModeSettings)) {
    let value = event.params.updateModeSettings[mode];
    for (mappingMode of device.mappings.Modes) {
      if (mappingMode.mode_attributes.name === mode) {
        fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, mappingMode, value));

        let ret = {
          states: {
            currentModeSettings: {}
          },
          status: 'SUCCESS',
          ids: [device.uuid_base]
        };
        ret.states.currentModeSettings[mode] = value;
        retArr.push(ret);
      }
    }
  }

  return retArr;
} //processEXECUTESetModes
module.exports.processEXECUTESetModes = processEXECUTESetModes;

async function execFHEMCommand(uid, reqId, device, mapping, value, traitCommand) {
  var c = mapping;
  if (typeof mapping === 'object') {
    uidlog(uid, 'mapping: ' + JSON.stringify(mapping));
    c = mapping.cmd;
  } else
    uidlog(uid, device.name + ' sending command ' + c + ' with value ' + value);

  var command = undefined;
  if (c == 'identify') {
    if (device.type == 'HUEDevice')
      command = 'set ' + device.device + ' alert select';
    else
      command = 'set ' + device.device + ' toggle; sleep 1; set ' + device.device + ' toggle';

  } else if (c == 'xhue') {
    value = Math.round(value * device.mappings.Hue.max / device.mappings.Hue.maxValue);
    command = 'set ' + device.mappings.Hue.device + ' hue ' + value;

  } else if (c == 'xsat') {
    value = value / 100 * device.mappings.Saturation.max;
    command = 'set ' + device.mappings.Saturation.device + ' sat ' + value;

  } else {
    if (mapping.characteristic_type === 'On' && value) {
      if (device.delayed_timers && device.delayed_timers.length) {
        uidlog(uid, device.name + ': skipping set cmd for ' + mapping.characteristic_type + ' with value ' + value);
        return;
      }
    }

    uidlog(uid, device.name + ': executing set cmd for ' + mapping.characteristic_type + ' with value ' + value);

    if (typeof mapping.homekit2reading === 'function') {
      try {
        value = await mapping.homekit2reading(mapping, value);
      } catch (err) {
        uiderror(uid, mapping.reading.toString() + ' homekit2reading: ' + err);
        return;
      }
      if (value === undefined) {
        uidlog(uid, '  converted value is unchanged ');
        return;

      }

      uidlog(uid, '  value converted to ' + value);

    } else {
      if (typeof value === 'number') {
        var mapped = value;
        if (mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined) {
          mapped = mapping.maxValue - value + mapping.minValue;
        } else if (mapping.invert && mapping.maxValue !== undefined) {
          mapped = mapping.maxValue - value;
        } else if (mapping.invert) {
          mapped = 100 - value;
        }

        if (value !== mapped) {
          uidlog(uid, '  value: ' + value + ' inverted to ' + mapped);
          value = mapped;
        }

        if (mapping.factor) {
          mapped /= mapping.factor;
          uidlog(uid, '  value: ' + value + ' mapped to ' + mapped);
          value = mapped;
        }


        if (mapping.max !== undefined && mapping.maxValue != undefined)
          value = Math.round((value * mapping.max / mapping.maxValue) * 100) / 100;
      }

    }

    var cmd;
    if (mapping.cmd) {
      cmd = mapping.cmd + ' ' + value;
    } else {
      cmd = value;
    }

    if (mapping.characteristic_type == 'StartStop' && traitCommand && traitCommand == 'PauseUnpause') {
      if (mapping.cmdPause !== undefined && value == 1)
        cmd = mapping.cmdPause;
      else if (mapping.cmdUnpause !== undefined && value == 0)
        cmd = mapping.cmdUnpause;
    } else {
      if (mapping.cmdOn !== undefined && value == 1)
        cmd = mapping.cmdOn;

      else if (mapping.cmdOff !== undefined && value == 0)
        cmd = mapping.cmdOff;

      else if (mapping.cmdUp !== undefined && value > 0) {
        cmd = mapping.cmdUp;
        for (var i = 1; i < value; i++)
          cmd = cmd + ";" + mapping.cmdUp;
      }

      else if (mapping.cmdDown !== undefined && value < 0) {
        cmd = mapping.cmdDown;
        for (var i = -1; i > value; i--)
          cmd = cmd + ";" + mapping.cmdDown;
      }

      else if (mapping.cmdOpen !== undefined && ((value >= 50 && !mapping.invert) || (value < 50 && mapping.invert === true)))
        cmd = mapping.cmdOpen;

      else if (mapping.cmdClose !== undefined && ((value < 50 && !mapping.invert) || (value >= 50 && mapping.invert === true)))
        cmd = mapping.cmdClose;

      else if (typeof mapping.homekit2cmd === 'object' && mapping.homekit2cmd[value] !== undefined)
        cmd = mapping.homekit2cmd[value];

      else if (typeof mapping.homekit2cmd_re === 'object') {
        for (var entry of mapping.homekit2cmd_re) {
          if (value.toString().match(entry.re)) {
            cmd = entry.to;
            break;
          }
        }
      }
    }

    if (cmd === undefined) {
      uiderror(uid, device.name + ' no cmd for ' + c + ', value ' + value);
      return;
    }

    cmd = cmd.replace(/;/gi, ';set ' + mapping.device + ' ');
    command = 'set ' + mapping.device + ' ' + cmd;

  }

  if (mapping.delayAfter) {
    var sleepVal = parseInt(mapping.delayAfter);
    if (isNaN(sleepVal)) {
      command = command + ";sleep 1";
    } else {
      command = command + ";sleep " + sleepVal;
    }
  }

  if (command === undefined) {
    uiderror(uid, device.name + ' Unhandled command! cmd=' + c + ', value ' + value);
    return;
  }

  if (mapping.cmdSuffix !== undefined)
    command += ' ' + mapping.cmdSuffix;

  uidlog(uid, 'EXECUTE: ' + JSON.stringify(command) + ',' + JSON.stringify(device.connection));
  return {
    id: reqId,
    cmd: command,
    connection: device.connection
  };
}
module.exports.execFHEMCommand = execFHEMCommand;