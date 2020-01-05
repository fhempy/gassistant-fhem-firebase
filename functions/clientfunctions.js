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
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(utils.jwtCheck);
app.use(function (req, res, next) {
  const {
    sub: uid
  } = req.user;
  uidlog(uid, 'Function called: ' + req.originalUrl);
  next();
});

app.get('/3.0/gethandleEXECUTE', async (req, res) => {
  function getCommandMapping() {
    const commandMapping = {};
    commandMapping[REQUEST_SET_BRIGHTNESSABSOLUTE] = 'Brightness';
    commandMapping[REQUEST_SET_MODES] = 'Modes';
    commandMapping[REQUEST_ON_OFF] = 'On';
    commandMapping[REQUEST_SET_TARGET_TEMPERATURE] = 'TargetTemperature';
    commandMapping[REQUEST_SET_THERMOSTAT_MODE] = 'ThermostatModes';
    commandMapping[REQUEST_DOCK] = 'Dock';
    commandMapping[REQUEST_LOCATE] = 'Locate';
    commandMapping[REQUEST_STARTSTOP] = 'StartStop';
    commandMapping[REQUEST_PAUSEUNPAUSE] = 'StartStop';
    commandMapping[REQUEST_FANSPEED] = 'FanSpeed';
    commandMapping[REQUEST_FANSPEEDREVERSE] = 'FanSpeed';
    commandMapping[REQUEST_COLORABSOLUTE] = 'RGB';
    commandMapping[REQUEST_SET_TOGGLES] = 'Toggles';
    commandMapping[REQUEST_ACTIVATE_SCENE] = 'Scene';
    commandMapping[REQUEST_OPENCLOSE] = 'OpenClose';
    commandMapping[REQUEST_ARMDISARM] = 'ArmDisarm';
    commandMapping[REQUEST_TIMERSTART] = 'Timer';
    commandMapping[REQUEST_TIMERADJUST] = 'Timer';
    commandMapping[REQUEST_TIMERPAUSE] = 'Timer';
    commandMapping[REQUEST_TIMERRESUME] = 'Timer';
    commandMapping[REQUEST_TIMERCANCEL] = 'Timer';

    return commandMapping;
  }

  function prepareDevice(dev) {
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

  function loadDevices() {
    var devices = {};

    var allDevices = database.getMappings();
    Object.keys(allDevices).forEach(function (device) {
      var a = {
        'device': allDevices[device]['XXXDEVICEDEFXXX'],
        'readings': {}
      };
      prepareDevice(a['device']);
      devices[allDevices[device]['XXXDEVICEDEFXXX'].name] = a['device'];
    });
    return devices;
  }

  function processEXECUTE(uid, reqId, input) {
    let responses = [];
    let fhemExecCmd = [];
    let allDevices;

    for (cmd of input.payload.commands) {
      for (exec of cmd.execution) {
        allDevices = loadDevices(uid);

        for (d of cmd.devices) {
          device = allDevices[d.customData.device];

          if (Object.keys(device).length === 0) {
            logger.error("Device " + d.customData.device + " not found, try reload.");
            return {
              errorCode: 'deviceNotFound'
            };
          }

          const requestedName = exec.command;

          if (!getCommandMapping()[requestedName] || !device.mappings[getCommandMapping()[requestedName]]) {
            logger.error('Command ' + requestedName + ' not configured for device ' + d.customData.device);
            return {
              errorCode: 'functionNotSupported'
            };
          }

          if (device.mappings[getCommandMapping()[requestedName]].pin) {
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
              if (!exec.challenge || exec.challenge.pin !== device.mappings[getCommandMapping()[requestedName]].pin) {
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

          switch (requestedName) {

            case REQUEST_ON_OFF:
              responses.push(...processEXECUTEOnOff(uid, reqId, device, exec.params.on ? 1 : 0, fhemExecCmd));
              break;

            case REQUEST_SET_BRIGHTNESSABSOLUTE:
              responses.push(...processEXECUTEBrightnessAbsolute(uid, reqId, device, exec.params.brightness, fhemExecCmd));
              break;

            case REQUEST_SET_TARGET_TEMPERATURE:
              responses.push(...processEXECUTESetTargetTemperature(uid, reqId, device, exec.params.thermostatTemperatureSetpoint, fhemExecCmd));
              break;

            case REQUEST_SET_THERMOSTAT_MODE:
              responses.push(...processEXECUTESetThermostatMode(uid, reqId, device, exec.params.thermostatMode, fhemExecCmd));
              break;

            case REQUEST_DOCK:
              responses.push(...processEXECUTEDock(uid, reqId, device, fhemExecCmd));
              break;

            case REQUEST_LOCATE:
              responses.push(...processEXECUTELocate(uid, reqId, device, fhemExecCmd));
              break;

            case REQUEST_STARTSTOP:
              responses.push(...processEXECUTEStartStop(uid, reqId, device, exec.params.start ? 1 : 0, fhemExecCmd));
              break;

            case REQUEST_PAUSEUNPAUSE:
              responses.push(...processEXECUTEPauseUnpause(uid, reqId, device, exec.params.pause ? 1 : 0, fhemExecCmd));
              break;

            case REQUEST_FANSPEED:
              responses.push(...processEXECUTESetFanSpeed(uid, reqId, device, exec.params.fanSpeed, fhemExecCmd));
              break;

            case REQUEST_COLORABSOLUTE:
              responses.push(...processEXECUTESetColorAbsolute(uid, reqId, device, exec.params.color, fhemExecCmd));
              break;

            case REQUEST_SET_TOGGLES:
              responses.push(...processEXECUTESetToggles(uid, reqId, device, exec.params.updateToggleSettings, fhemExecCmd));
              break;

            case REQUEST_ACTIVATE_SCENE:
              responses.push(...processEXECUTEActivateScene(uid, reqId, device, d.customData.scenename, exec.params.deactivate, fhemExecCmd));
              break;

            case REQUEST_FANSPEEDREVERSE:
              //responses.push(...processEXECUTEReverse(uid, reqId,exec.params.reverse));
              break;

              //action.devices.traits.Modes: COMMANDS
            case REQUEST_SET_MODES:
              responses.push(...processEXECUTESetModes(uid, reqId, device, exec, fhemExecCmd));
              break;

            case REQUEST_OPENCLOSE:
              responses.push(...processEXECUTESetOpenClose(uid, reqId, device, exec.params, fhemExecCmd));
              break;

            case REQUEST_ARMDISARM:
              responses.push(...processEXECUTEArmDisarm(uid, reqId, device, exec.params, fhemExecCmd));
              break;

            case REQUEST_TIMERSTART:
              responses.push(...processEXECUTETimerStart(uid, reqId, device, exec.params, fhemExecCmd));
              break;

            default:
              //return unsupported operation
              logger.error("Unsupported operation" + requestedName);
              return {
                errorCode: 'functionNotSupported'
              };
          } // switch
        }
      }
    }

    //send to FHEM
    var fcmds = {};
    for (var c of fhemExecCmd) {
      fcmds[c.connection] = fcmds[c.connection] ? fcmds[c.connection] + ';' + c.cmd : c.cmd;
    }
    for (var c in fcmds) {
      require('./fhem').FHEM_execute({
        base_url: c
      }, fcmds[c]);
    }

    //create response payload
    return {
      commands: responses
    };
  }; // processEXECUTE

  function processEXECUTEOnOff(uid, reqId, device, state, fhemExecCmd) {
    if (!device.mappings.On) {
      return [{
        errorCode: 'notSupported'
      }];
    }

    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.On, state));

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
  } // processEXECUTETurnOff

  function processEXECUTEArmDisarm(uid, reqId, device, params, fhemExecCmd) {
    var arm = false;
    if (params.arm) {
      if (params.cancel) {
        fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.ArmDisarm, device.mappings.ArmDisarm.cmdCancel));
      } else {
        arm = true;
        fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.ArmDisarm, device.mappings.ArmDisarm.cmdArm));
      }
    } else {
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.ArmDisarm, device.mappings.ArmDisarm.cmdDisarm));
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

  function processEXECUTETimerStart(uid, reqId, device, params, fhemExecCmd) {
    if (device.mappings.Timer.cmdTimerStart) {
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.Timer, device.mappings.Timer.cmdTimerStart + ' ' + params.timerTimeSec));
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

  function processEXECUTESetOpenClose(uid, reqId, device, params, fhemExecCmd) {
    if (device.mappings.TargetPosition && params.openPercent !== 0 && params.openPercent !== 100) {
      //TargetPosition supported
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.TargetPosition, params.openPercent));
    } else {
      //only up/down supported
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.OpenClose, params.openPercent));
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

  function processEXECUTEBrightnessAbsolute(uid, reqId, device, brightness, fhemExecCmd) {
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

    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, mapping, parseInt(target)));

    return [{
      ids: [device.uuid_base],
      status: 'SUCCESS',
      states: {
        brightness: brightness
      }
    }];
  }; // processEXECUTEBrightnessAbsolute

  function processEXECUTESetTargetTemperature(uid, reqId, device, targetTemperature, fhemExecCmd) {
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

    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.TargetTemperature, targetTemperature));

    return [{
      states: {
        thermostatTemperatureSetpoint: targetTemperature
      },
      status: 'success',
      ids: [device.uuid_base]
    }];
  }; // processEXECUTESetTargetTemperature

  function processEXECUTESetThermostatMode(uid, reqId, device, thermostatMode, fhemExecCmd) {
    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.ThermostatModes, thermostatMode));

    return [{
      states: {
        thermostatMode: thermostatMode
      },
      status: 'success',
      ids: [device.uuid_base]
    }];
  };

  function processEXECUTEDock(uid, reqId, device, fhemExecCmd) {
    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.Dock, ''));

    return [{
      states: {
        isDocked: true
      },
      status: 'success',
      ids: [device.uuid_base]
    }];
  }; //processEXECUTEDock

  function processEXECUTELocate(uid, reqId, device, fhemExecCmd) {
    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.Locate, ''));

    return [{
      states: {
        generatedAlert: true
      },
      status: 'success',
      ids: [device.uuid_base]
    }];
  }; //processEXECUTELocate

  function processEXECUTEStartStop(uid, reqId, device, start, fhemExecCmd) {
    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.StartStop, start));

    return [{
      states: {
        isRunning: start
      },
      status: 'success',
      ids: [device.uuid_base]
    }];
  }; //processEXECUTEStartStop

  function processEXECUTEPauseUnpause(uid, reqId, device, pause, fhemExecCmd) {
    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.StartStop, pause, 'PauseUnpause'));

    return [{
      states: {
        isPaused: pause
      },
      status: 'success',
      ids: [device.uuid_base]
    }];
  }; //processEXECUTEPauseUnpause

  function processEXECUTESetFanSpeed(uid, reqId, device, speedname, fhemExecCmd) {
    fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.FanSpeed, device.mappings.FanSpeed.speeds[speedname].cmd));

    return [{
      states: {
        currentFanSpeedSetting: speedname
      },
      status: 'success',
      ids: [device.uuid_base]
    }];
  }; //processEXECUTEPauseUnpause

  function processEXECUTESetColorAbsolute(uid, reqId, device, color, fhemExecCmd) {
    let ret = [];

    if (color.spectrumRGB) {
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.RGB, color.spectrumRGB));
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
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.Hue, color.spectrumHSV.hue));
      //Brightness
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.HSVBrightness, color.spectrumHSV.value));
      //Saturation
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.Saturation, color.spectrumHSV.saturation));
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
      fhemExecCmd.push(execFHEMCommand(uid, reqId, device, device.mappings.ColorTemperature, color.temperature));
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

  function processEXECUTESetToggles(uid, reqId, device, toggleSettings, fhemExecCmd) {
    let retArr = [];

    for (toggle of Object.keys(toggleSettings)) {
      let value = toggleSettings[toggle];
      for (mappingToggle of device.mappings.Toggles) {
        if (mappingToggle.toggle_attributes.name == toggle) {
          fhemExecCmd.push(execFHEMCommand(uid, reqId, device, mappingToggle, value));

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

  function processEXECUTEActivateScene(uid, reqId, device, scenename, deactivate, fhemExecCmd) {
    for (s of device.mappings.Scene) {
      if (s.scenename == scenename) {
        fhemExecCmd.push(execFHEMCommand(uid, reqId, device, s, deactivate ? 0 : 1));
      }
    }

    return [{
      states: {},
      status: 'success',
      ids: [device.uuid_base.replace(/[^\w_\-=#;:?@&]/g, '_') + '-' + scenename]
    }];
  }; //processEXECUTEActivateScene

  function processEXECUTESetModes(uid, reqId, device, event, fhemExecCmd) {
    let retArr = [];
    for (mode of Object.keys(event.params.updateModeSettings)) {
      let value = event.params.updateModeSettings[mode];
      for (mappingMode of device.mappings.Modes) {
        if (mappingMode.mode_attributes.name === mode) {
          fhemExecCmd.push(execFHEMCommand(uid, reqId, device, mappingMode, value));

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

  function execFHEMCommand(uid, reqId, device, mapping, value, traitCommand) {
    var c = mapping;
    if (typeof mapping === 'object') {
      logger.debug('mapping: ' + JSON.stringify(mapping));
      c = mapping.cmd;
    } else
      logger.debug(device.name + ' sending command ' + c + ' with value ' + value);

    var command = undefined;
    if (c == 'identify') {
      if (device.type == 'HUEDevice')
        command = 'set ' + device.device + 'alert select';
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
          logger.debug(device.name + ': skipping set cmd for ' + mapping.characteristic_type + ' with value ' + value);
          return;
        }
      }

      logger.debug(device.name + ': executing set cmd for ' + mapping.characteristic_type + ' with value ' + value);

      if (typeof mapping.homekit2reading === 'function') {
        try {
          value = mapping.homekit2reading(mapping, value);
        } catch (err) {
          logger.error(mapping.reading.toString() + ' homekit2reading: ' + err);
          return;
        }
        if (value === undefined) {
          logger.debug('  converted value is unchanged ');
          return;

        }

        logger.debug('  value converted to ' + value);

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
            logger.debug('  value: ' + value + ' inverted to ' + mapped);
            value = mapped;
          }

          if (mapping.factor) {
            mapped /= mapping.factor;
            logger.debug('  value: ' + value + ' mapped to ' + mapped);
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

        else if (mapping.cmdOpen !== undefined && ((value >= 50 && !mapping.invert) || (value < 50 && mapping.invert === true)))
          cmd = mapping.cmdOpen;

        else if (mapping.cmdOpen !== undefined && ((value < 50 && !mapping.invert) || (value >= 50 && mapping.invert === true)))
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
        logger.error(device.name + ' no cmd for ' + c + ', value ' + value);
        return;
      }

      command = 'set ' + mapping.device + ' ' + cmd;

    }

    if (command === undefined) {
      logger.error(device.name + ' Unhandled command! cmd=' + c + ', value ' + value);
      return;
    }

    if (mapping.cmdSuffix !== undefined)
      command += ' ' + mapping.cmdSuffix;

    logger.debug('EXECUTE: ' + JSON.stringify(command) + ',' + JSON.stringify(device.connection));
    return {
      id: reqId,
      cmd: command,
      connection: device.connection
    };
  }

  res.send({
    'exports.handleEXECUTE': require('./handleEXECUTE').handleEXECUTE.toString(),
    'global.getCommandMapping': getCommandMapping.toString(),
    'global.prepareDevice': prepareDevice.toString(),
    'global.loadDevices': loadDevices.toString(),
    'global.processEXECUTE': processEXECUTE.toString(),
    'global.processEXECUTEOnOff': processEXECUTEOnOff.toString(),
    'global.processEXECUTEArmDisarm': processEXECUTEArmDisarm.toString(),
    'global.processEXECUTETimerStart': processEXECUTETimerStart.toString(),
    'global.processEXECUTESetOpenClose': processEXECUTESetOpenClose.toString(),
    'global.processEXECUTEBrightnessAbsolute': processEXECUTEBrightnessAbsolute.toString(),
    'global.processEXECUTESetTargetTemperature': processEXECUTESetTargetTemperature.toString(),
    'global.processEXECUTESetThermostatMode': processEXECUTESetThermostatMode.toString(),
    'global.processEXECUTEDock': processEXECUTEDock.toString(),
    'global.processEXECUTELocate': processEXECUTELocate.toString(),
    'global.processEXECUTEStartStop': processEXECUTEStartStop.toString(),
    'global.processEXECUTEPauseUnpause': processEXECUTEPauseUnpause.toString(),
    'global.processEXECUTESetFanSpeed': processEXECUTESetFanSpeed.toString(),
    'global.processEXECUTESetColorAbsolute': processEXECUTESetColorAbsolute.toString(),
    'global.processEXECUTESetToggles': processEXECUTESetToggles.toString(),
    'global.processEXECUTEActivateScene': processEXECUTEActivateScene.toString(),
    'global.processEXECUTESetModes': processEXECUTESetModes.toString(),
    'global.execFHEMCommand': execFHEMCommand.toString(),

    // trait commands => https://developers.google.com/actions/smarthome/traits/
    'global.REQUEST_SET_BRIGHTNESSABSOLUTE': "'action.devices.commands.BrightnessAbsolute'",
    'global.REQUEST_SET_MODES': "'action.devices.commands.SetModes'",
    'global.REQUEST_ON_OFF': "'action.devices.commands.OnOff'",
    'global.REQUEST_SET_TARGET_TEMPERATURE': "'action.devices.commands.ThermostatTemperatureSetpoint'",
    'global.REQUEST_SET_THERMOSTAT_MODE': "'action.devices.commands.ThermostatSetMode'",
    'global.REQUEST_DOCK': "'action.devices.commands.Dock'",
    'global.REQUEST_LOCATE': "'action.devices.commands.Locate'",
    'global.REQUEST_STARTSTOP': "'action.devices.commands.StartStop'",
    'global.REQUEST_PAUSEUNPAUSE': "'action.devices.commands.PauseUnpause'",
    'global.REQUEST_FANSPEED': "'action.devices.commands.SetFanSpeed'",
    'global.REQUEST_FANSPEEDREVERSE': "'action.devices.commands.Reverse'",
    'global.REQUEST_COLORABSOLUTE': "'action.devices.commands.ColorAbsolute'",
    'global.REQUEST_SET_TOGGLES': "'action.devices.commands.SetToggles'",
    'global.REQUEST_ACTIVATE_SCENE': "'action.devices.commands.ActivateScene'",
    'global.REQUEST_OPENCLOSE': "'action.devices.commands.OpenClose'",
    'global.REQUEST_ARMDISARM': "'action.devices.commands.ArmDisarm'",
    'global.REQUEST_TIMERSTART': "'action.devices.commands.TimerStart'",
    'global.REQUEST_TIMERADJUST': "'action.devices.commands.TimerAdjust'",
    'global.REQUEST_TIMERPAUSE': "'action.devices.commands.TimerPause'",
    'global.REQUEST_TIMERRESUME': "'action.devices.commands.TimerResume'",
    'global.REQUEST_TIMERCANCEL': "'action.devices.commands.TimerCancel'"
  });
});

app.get('/getdynamicfunctions', async (req, res) => {
  const {
    sub: uid
  } = req.user;

  function getInitSyncURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/initsync";
  }

  function getSyncFinishedURL() {
    return CLOUD_FUNCTIONS_BASE + "/api/syncfinished";
  }

  function getReportStateAllURL() {
    return CLOUD_FUNCTIONS_BASE.replace('europe-west1', 'us-central1') + "/reportstate/alldevices";
  }

  function getReportStateURL() {
    return CLOUD_FUNCTIONS_BASE.replace('europe-west1', 'us-central1') + "/reportstate/singledevice";
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
    } catch (err) {
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
          require('./fhem').FHEM_execute({
            base_url: event.connection
          }, event.cmd);
          break;

        case 'REPORTSTATEALL':
          setTimeout(require('./database').reportStateAll, parseInt(event.delay) * 1000);
          break;

        case 'UPDATE_SYNCFEATURELEVEL':
          for (var fhem of this.connections) {
            fhem.execute('setreading ' + fhem.gassistant + ' gassistant-fhem-usedFeatureLevel ' + event.featurelevel);
            fhem.execute('setreading ' + fhem.gassistant + ' gassistant-fhem-googleSync Google SYNC finished');
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

      } // switch

    } catch (error) {

      log.error(error);

    } // try-catch

    //return response;

  } // exports.handler


  async function updateDeviceReading(device, reading, val) {
    await database.realdb.ref('users/' + database.getUid() + '/readings/' + device.replace(/\.|\#|\[|\]|\$/g, '_') + '/' + reading.replace(/\.|\#|\[|\]|\$/g, '_')).set({
      value: val,
      devname: device
    });
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

    if (!FHEM_reportStateStore[device])
      FHEM_reportStateStore[device] = {};

    if (!FHEM_reportStateStore[device][reading])
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