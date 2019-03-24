const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');
const createDirective = require('./utils').createDirective;
const settings = require('./settings.json');
var compareVersions = require('compare-versions');

const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;

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


async function handleEXECUTE(uid, reqId, res, input) {
  try {
    var payload = await processEXECUTE(uid, reqId, input);
    if (settings.CHECK_CLIENT_VERSION) {
      var clientVersion = await utils.getClientVersion(uid);
      if (compareVersions(clientVersion, settings.MIN_CLIENT_VERSION) < 0) {
        uiderror(uid, 'CLIENT UPDATE NEEDED (sudo npm install -g gassistant-fhem --unsafe-perm)');
        if (input.context && input.context.locale_language === 'de') {
          uidlog(uid, 'CLIENT UPDATE NEEDED - VOICE');
          payload = {"errorCode": "needsSoftwareUpdate"};
        }
      }
    }
    var response = createDirective(reqId, payload);
    res.send(response);
  } catch (err) {
    uiderror(uid, err, err);
    res.send(createDirective(reqId, {errorCode: 'hardError'}));
  }
}

async function processEXECUTE(uid, reqId, input) {

    let responses = [];
    let fhemExecCmd = [];
    let allDevices;

    for (cmd of input.payload.commands) {
        for (exec of cmd.execution) {
          if (cmd.devices.length > 1)
            allDevices = await utils.loadDevices(uid);

          for (d of cmd.devices) {
            if (allDevices && allDevices[d.customData.device])
              device = allDevices[d.customData.device];
            else
              device = await utils.loadDevice(uid, d.customData.device);

            const requestedName = exec.command;

            switch (requestedName) {

                case REQUEST_ON_OFF :
                    responses.push(...await processEXECUTEOnOff(uid, reqId, device, exec.params.on ? 1 : 0, fhemExecCmd));
                    break;

                case REQUEST_SET_BRIGHTNESSABSOLUTE :
                    responses.push(...await processEXECUTEBrightnessAbsolute(uid, reqId, device, exec.params.brightness, fhemExecCmd));
                    break;

                case REQUEST_SET_TARGET_TEMPERATURE:
                    responses.push(...await processEXECUTESetTargetTemperature(uid, reqId, device, exec.params.thermostatTemperatureSetpoint, fhemExecCmd));
                    break;

                case REQUEST_SET_THERMOSTAT_MODE:
                    responses.push(...await processEXECUTESetThermostatMode(uid, reqId, device, exec.params.thermostatMode, fhemExecCmd));
                    break;

                case REQUEST_DOCK:
                    responses.push(...await processEXECUTEDock(uid, reqId, device, fhemExecCmd));
                    break;
                    
                case REQUEST_LOCATE:
                    responses.push(...await processEXECUTELocate(uid, reqId, device, fhemExecCmd));
                    break;
                    
                case REQUEST_STARTSTOP:
                    responses.push(...await processEXECUTEStartStop(uid, reqId, device, exec.params.start ? 1 : 0, fhemExecCmd));
                    break;

                case REQUEST_PAUSEUNPAUSE:
                    responses.push(...await processEXECUTEPauseUnpause(uid, reqId, device, exec.params.pause ? 1 : 0, fhemExecCmd));
                    break;

                case REQUEST_FANSPEED:
                    responses.push(...await processEXECUTESetFanSpeed(uid, reqId, device, exec.params.fanSpeed, fhemExecCmd));
                    break;

                case REQUEST_COLORABSOLUTE:
                    responses.push(...await processEXECUTESetColorAbsolute(uid, reqId, device, exec.params.color, fhemExecCmd));
                    break;

                case REQUEST_SET_TOGGLES:
                    responses.push(...await processEXECUTESetToggles(uid, reqId, device, exec.params.updateToggleSettings, fhemExecCmd));
                    break;

                case REQUEST_ACTIVATE_SCENE:
                    responses.push(...await processEXECUTEActivateScene(uid, reqId, device, d.customData.scenename, exec.params.deactivate, fhemExecCmd));
                    break;

                case REQUEST_FANSPEEDREVERSE:
                    //responses.push(...await processEXECUTEReverse(uid, reqId,exec.params.reverse));
                    break;

                //action.devices.traits.Modes: COMMANDS
                case REQUEST_SET_MODES:
                    responses.push(...await processEXECUTESetModes(uid, reqId, device, exec, fhemExecCmd));
                    break;

                case REQUEST_OPENCLOSE:
                    responses.push(...await processEXECUTESetOpenClose(uid, reqId, device, exec.params, fhemExecCmd));
                    break;
                    
                default:
                    //return unsupported operation
                    uiderror(uid, "Unsupported operation" + requestedName);
                    return {errorCode: 'functionNotSupported'};
            }// switch
          }
        }
    }

    //send to FHEM
    var fcmds = {};
    for (var c of fhemExecCmd) {
      fcmds[c.connection] = fcmds[c.connection] ? fcmds[c.connection] + ';' + c.cmd : c.cmd;
    }
    for (var c in fcmds) {
      await admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({msg: 'EXECUTE', id: 0, cmd: fcmds[c], connection: c});
    }

    //create response payload
    return {commands: responses};
}; // processEXECUTE

async function processEXECUTEOnOff(uid, reqId, device, state, fhemExecCmd) {
    if (!device.mappings.On) {
      return [{
          errorCode: 'notSupported'
      }];
    }

    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.On, state));

    let res = [];

    res.push({
        ids: [device.id],
        status: 'SUCCESS',
        states: {
            on: true,
            online: true
        }
    });

    return res;
}// processEXECUTETurnOff

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
        ids: [device.id],
        status: 'SUCCESS',
        states: {
            openPercent: params.openPercent,
            online: true
        }
    });

    return res;
}// processEXECUTESetOpenClose

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
        ids: [device.id],
        status: 'SUCCESS',
        states: {
            brightness: brightness
        }
    }];
}; // processEXECUTEBrightnessAbsolute

async function processEXECUTESetTargetTemperature(uid, reqId, device, targetTemperature, fhemExecCmd) {
    let min = parseFloat(device.mappings.TargetTemperature.minValue);
    if (min === undefined) min = 15.0;
    let max = parseFloat(device.mappings.TargetTemperature.maxValue);
    if (max === undefined) max = 30.0;

    if (targetTemperature < min || targetTemperature > max)
        return [{
          ids: [device.id],
          status: 'ERROR',
          errorCode: 'valueOutOfRange'
        }];

    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.TargetTemperature, targetTemperature));

    return [{
        states: {
            thermostatTemperatureSetpoint: targetTemperature
        },
        status: 'success',
        ids: [device.id]
    }];
}; // processEXECUTESetTargetTemperature

async function processEXECUTESetThermostatMode(uid, reqId, device, thermostatMode, fhemExecCmd) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.ThermostatModes, thermostatMode));

    return [{
        states: {
            thermostatMode: thermostatMode
        },
        status: 'success',
        ids: [device.id]
    }];
};

async function processEXECUTEDock(uid, reqId, device, fhemExecCmd) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Dock, ''));

    return [{
        states: {
            isDocked: true
        },
        status: 'success',
        ids: [device.id]
    }];
}; //processEXECUTEDock

async function processEXECUTELocate(uid, reqId, device, fhemExecCmd) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.Locate, ''));

    return [{
        states: {
            generatedAlert: true
        },
        status: 'success',
        ids: [device.id]
    }];
}; //processEXECUTELocate

async function processEXECUTEStartStop(uid, reqId, device, start, fhemExecCmd) {
    await execFHEMCommand(uid, reqId, device, device.mappings.SartStop, start);

    return [{
        states: {
            isRunning: start
        },
        status: 'success',
        ids: [device.id]
    }];
}; //processEXECUTEStartStop

async function processEXECUTEPauseUnpause(uid, reqId, device, pause, fhemExecCmd) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.SartStop, pause, 'PauseUnpause'));

    return [{
        states: {
            isPaused: pause
        },
        status: 'success',
        ids: [device.id]
    }];
}; //processEXECUTEPauseUnpause

async function processEXECUTESetFanSpeed(uid, reqId, device, speedname, fhemExecCmd) {
    fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, device.mappings.FanSpeed, speedname));

    return [{
        states: {
            currentFanSpeedSetting: speedname
        },
        status: 'success',
        ids: [device.id]
    }];
}; //processEXECUTEPauseUnpause

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
            ids: [device.id],
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
            ids: [device.id],
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
            ids: [device.id],
            status: "SUCCESS",
            online: "true"
        });
    }

    return ret;
}; // processEXECUTESetColorAbsolute

async function processEXECUTESetToggles(uid, reqId, device, toggleSettings, fhemExecCmd) {
    let retArr = [];

		for (toggle of Object.keys(toggleSettings)) {
			let value = toggleSettings[toggle];
			for (mappingToggle of device.mappings.Toggles) {
				if (mappingToggle.toggle_attributes.name == toggle) {
				  fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, mappingToggle, value));

					let ret = {
						states: {
							currentToggleSettings: {
							}
						},
						status: 'SUCCESS',
						ids: [device.id]
					};
					ret.states.currentToggleSettings[toggle] = value;
					retArr.push(ret);
				}
			}
		}

    return retArr;
}//processEXECUTESetToggles

async function processEXECUTEActivateScene(uid, reqId, device, scenename, deactivate, fhemExecCmd) {
    for (s of device.mappings.Scene) {
        if (s.scenename == scenename) {
            fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, s, deactivate ? 0 : 1));
        }
    }

    return [{
        states: {
        },
        status: 'success',
        ids: [device.id]
    }];
}; //processEXECUTEActivateScene

async function processEXECUTESetModes(uid, reqId, device, event, fhemExecCmd) {
  let retArr = [];
	for (mode of Object.keys(event.params.updateModeSettings)) {
		let value = event.params.updateModeSettings[mode];
		for (mappingMode of device.mappings.Modes) {
			if (mappingMode.mode_attributes.name === mode) {
				fhemExecCmd.push(await execFHEMCommand(uid, reqId, device, mappingMode, value));

				let ret = {
					states: {
						currentModeSettings: {
						}
					},
					status: 'SUCCESS',
					ids: [device.id]
				};
				ret.states.currentModeSettings[mode] = value;
				retArr.push(ret);
			}
		}
	}

  return retArr;
}//processEXECUTESetModes

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
        if (mapping.characteristic_type == 'On' && value) {
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
                    value = Math.round((value * mapping.max / mapping.maxValue)*100)/100;
            }

        }

        var cmd = mapping.cmd + ' ' + value;

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
            uiderror(uid, device.name + ' no cmd for ' + c + ', value ' + value);
            return;
        }

        command = 'set ' + mapping.device + ' ' + cmd;

    }

    if (command === undefined) {
        uiderror(uid, device.name + ' Unhandled command! cmd=' + c + ', value ' + value);
        return;
    }

    if (mapping.cmdSuffix !== undefined)
        command += ' ' + mapping.cmdSuffix;

    uidlog(uid, 'EXECUTE: ' + JSON.stringify(command) + ',' + JSON.stringify(device.connection));
    return {id: reqId, cmd: command, connection: device.connection};
}

module.exports = {
  handleEXECUTE
};

