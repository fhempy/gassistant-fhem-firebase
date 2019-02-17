const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');
const createDirective = require('./utils').createDirective;

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


async function handleEXECUTE(uid, reqId, res, input) {
  //read current value from firestore
  try {
    var payload = await processEXECUTE(uid, reqId, input);
    var response = createDirective(reqId, payload);
    uidlog(uid, 'final response EXECUTE: ' + JSON.stringify(response));
  //const ref = await admin.firestore().collection(uid).doc('msgs').collection('firestore2google').add({msg: response, id: reqId});
    res.send(response);
  } catch (err) {
    uiderror(uid, err);
    res.send(createDirective(reqId, {errorCode: 'hardError'}));
  }
}

async function processEXECUTE(uid, reqId, input) {

    let responses = [];

    for (cmd of input.payload.commands) {
        for (exec of cmd.execution) {

            const requestedName = exec.command;

            switch (requestedName) {

                case REQUEST_ON_OFF :
                    responses.push(...await processEXECUTEOnOff(uid, reqId, cmd, exec.params.on ? 1 : 0));
                    break;

                case REQUEST_SET_BRIGHTNESSABSOLUTE :
                    responses.push(...await processEXECUTEBrightnessAbsolute(uid, reqId, cmd, exec.params.brightness));
                    break;

                case REQUEST_SET_TARGET_TEMPERATURE:
                    responses.push(...await processEXECUTESetTargetTemperature(uid, reqId, cmd, exec.params.thermostatTemperatureSetpoint));
                    break;

                case REQUEST_SET_THERMOSTAT_MODE:
                    responses.push(...await processEXECUTESetThermostatMode(uid, reqId, cmd, exec.params.thermostatMode));
                    break;

                case REQUEST_DOCK:
                    responses.push(...await processEXECUTEDock(uid, reqId, cmd));
                    break;
                    
                case REQUEST_LOCATE:
                    responses.push(...await processEXECUTELocate(uid, reqId, cmd));
                    break;
                    
                case REQUEST_STARTSTOP:
                    responses.push(...await processEXECUTEStartStop(uid, reqId, cmd, exec.params.start ? 1 : 0));
                    break;

                case REQUEST_PAUSEUNPAUSE:
                    responses.push(...await processEXECUTEPauseUnpause(uid, reqId, cmd, exec.params.pause ? 1 : 0));
                    break;

                case REQUEST_FANSPEED:
                    responses.push(...await processEXECUTESetFanSpeed(uid, reqId, cmd, exec.params.fanSpeed));
                    break;

                case REQUEST_COLORABSOLUTE:
                    responses.push(...await processEXECUTESetColorAbsolute(uid, reqId, cmd, exec.params.color));
                    break;

                case REQUEST_SET_TOGGLES:
                    responses.push(...await processEXECUTESetToggles(uid, reqId, cmd, exec.params.updateToggleSettings));
                    break;

                case REQUEST_ACTIVATE_SCENE:
                    responses.push(...await processEXECUTEActivateScene(uid, reqId, cmd, exec.params.deactivate));
                    break;

                case REQUEST_FANSPEEDREVERSE:
                    //responses.push(...await processEXECUTEReverse(uid, reqId,exec.params.reverse));
                    break;

                //action.devices.traits.Modes: COMMANDS
                case REQUEST_SET_MODES:
                    responses.push(...await processEXECUTESetModes(uid, reqId, cmd, exec));
                    break;
                    
                default:
                    //return unsupported operation
                    uiderror(uid, "Unsupported operation" + requestedName);
                    return {errorCode: 'functionNotSupported'};
            }// switch
        }
    }

    //create response payload
    return {commands: responses};
}; // processEXECUTE

async function processEXECUTEOnOff(uid, reqId, cmd, state) {
    let successIds = [];
    let failedIds = [];

    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device) {
            failedIds.push(d.id)
        } else {
            successIds.push(d.id)
            await execFHEMCommand(uid, reqId, device, device.mappings.On, state);
        }
    }

    let res = [];

    if (successIds.length > 0) {
        res.push({
            ids: successIds,
            status: 'SUCCESS',
            states: {
                on: true,
                online: true
            }
        })
    }

    if (failedIds.length > 0) {
        res.push({
            ids: failedIds,
            status: 'ERROR',
            errorCode: 'deviceTurnedOff'
        })
    }

    return res;
}// processEXECUTETurnOff

async function processEXECUTEBrightnessAbsolute(uid, reqId, cmd, brightness) {
    let deviceIds = [];

    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
            return [];

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

        await execFHEMCommand(uid, reqId, device, mapping, parseInt(target));
        deviceIds.push(d.id);
    }

    return [{
        ids: deviceIds,
        status: 'SUCCESS',
        states: {
            brightness: brightness
        }
    }];

}; // processEXECUTEBrightnessAbsolute

async function processEXECUTESetTargetTemperature(uid, reqId, cmd, targetTemperature) {

    let deviceIds = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
            return handleUnsupportedOperation();

        let min = device.mappings.TargetTemperature.minValue;
        if (min === undefined) min = 15.0;
        let max = device.mappings.TargetTemperature.maxValue;
        if (max === undefined) max = 30.0;

        if (targetTemperature < min || targetTemperature > max)
            return [{
              ids: devicesIds,
              status: 'ERROR',
              errorCode: 'valueOutOfRange'
            }];

        await execFHEMCommand(uid, reqId, device, device.mappings.TargetTemperature, targetTemperature);
        deviceIds.push(d.id);
    }

    return [{
        states: {
            thermostatTemperatureSetpoint: targetTemperature
        },
        status: 'success',
        ids: deviceIds
    }];

}; // processEXECUTESetTargetTemperature

async function processEXECUTESetThermostatMode(uid, reqId, cmd, thermostatMode) {
    let deviceIds = [];

    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
            return handleUnsupportedOperation();

        await execFHEMCommand(uid, reqId, device, device.mappings.ThermostatModes, thermostatMode);
        deviceIds.push(d.id);
    }

    return [{
        states: {
            thermostatMode: thermostatMode
        },
        status: 'success',
        ids: deviceIds
    }];
};

async function processEXECUTEDock(uid, reqId, cmd) {
    let deviceIds = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
          return handleUnsupportedOperation();

        await execFHEMCommand(uid, reqId, device, device.mappings.Dock, '');
        deviceIds.push(d.id);
    }

    return [{
        states: {
            isDocked: true
        },
        status: 'success',
        ids: deviceIds
    }];
}; //processEXECUTEDock

async function processEXECUTELocate(uid, reqId, cmd) {
    let deviceIds = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
          return handleUnsupportedOperation();

        await execFHEMCommand(uid, reqId, device, device.mappings.Locate, '');
        deviceIds.push(d.id);
    }

    return [{
        states: {
            generatedAlert: true
        },
        status: 'success',
        ids: deviceIds
    }];
}; //processEXECUTELocate

async function processEXECUTEStartStop(uid, reqId, cmd, start) {
    let deviceIds = [];
    uidlog(uid, 'cmd: ' + cmd);
    uidlog(uid, JSON.stringify(cmd));
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
          return handleUnsupportedOperation();

        await execFHEMCommand(uid, reqId, device, device.mappings.SartStop, start);
        deviceIds.push(d.id);
    }

    return [{
        states: {
            isRunning: start
        },
        status: 'success',
        ids: deviceIds
    }];
}; //processEXECUTEStartStop

async function processEXECUTEPauseUnpause(uid, reqId, cmd, pause) {
    let deviceIds = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
          return handleUnsupportedOperation();

        await execFHEMCommand(uid, reqId, device, device.mappings.SartStop, pause, 'PauseUnpause');
        deviceIds.push(d.id);
    }

    return [{
        states: {
            isPaused: pause
        },
        status: 'success',
        ids: deviceIds
    }];
}; //processEXECUTEPauseUnpause

async function processEXECUTESetFanSpeed(uid, reqId, cmd, speedname) {
    let deviceIds = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
          return handleUnsupportedOperation();

        await execFHEMCommand(uid, reqId, device, device.mappings.FanSpeed, speedname);
        deviceIds.push(d.id);
    }

    return [{
        states: {
            currentFanSpeedSetting: speedname
        },
        status: 'success',
        ids: deviceIds
    }];
}; //processEXECUTEPauseUnpause

async function processEXECUTESetColorAbsolute(uid, reqId, cmd, color) {
    let deviceIds = [];
    let ret = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
          return handleUnsupportedOperation();

        if (color.spectrumRGB) {
            await execFHEMCommand(uid, reqId, device, device.mappings.RGB, color.spectrumRGB);
            ret.push({
                states: {
                    color: {
                        spectrumRgb: color.spectrumRGB
                    }
                },
                ids: [d.id],
                status: "SUCCESS",
                online: "true"
            });
        } else if (color.spectrumHSV) {
            //Hue
            await execFHEMCommand(uid, reqId, device, device.mappings.Hue, color.spectrumHSV.hue);
            //Brightness
            await execFHEMCommand(uid, reqId, device, device.mappings.HSVBrightness, color.spectrumHSV.value);
            //Saturation
            await execFHEMCommand(uid, reqId, device, device.mappings.Saturation, color.spectrumHSV.saturation);
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
                ids: [d.id],
                status: "SUCCESS",
                online: "true"
            });
        } else if (color.temperature) {
            await execFHEMCommand(uid, reqId, device, device.mappings.ColorTemperature, color.temperature);
            ret.push({
                states: {
                    color: {
                        temperatureK: color.temperature
                    }
                },
                ids: [d.id],
                status: "SUCCESS",
                online: "true"
            });
        }
    }

    return ret;
}; // processEXECUTESetColorAbsolute

async function processEXECUTESetToggles(uid, reqId, cmd, toggleSettings) {

    let deviceIds = [];
    let retArr = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
            return handleUnsupportedOperation();

    		log.info(toggleSettings);
    		for (toggle of Object.keys(toggleSettings)) {
    			let value = toggleSettings[toggle];
    			for (mappingToggle of device.mappings.Toggles) {
    				if (mappingToggle.toggle_attributes.name == toggle) {
    				  await execFHEMCommand(uid, reqId, device, mappingToggle, value);

    					let ret = {
    						states: {
    							currentToggleSettings: {
    							}
    						},
    						status: 'SUCCESS',
    						ids: [d.id]
    					};
    					ret.states.currentToggleSettings[toggle] = value;
    					retArr.push(ret);
    				}
    			}
    		}
    }

    return retArr;
}//processEXECUTESetToggles

async function processEXECUTEActivateScene(uid, reqId, cmd, deactivate) {
    let deviceIds = [];
    
   for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
          return handleUnsupportedOperation();

        let scenename = d.customData.scenename;
        for (s of device.mappings.Scene) {
            if (s.scenename == scenename) {
                await execFHEMCommand(uid, reqId, device, s, deactivate ? 0 : 1);
                deviceIds.push(d.id);
            }
        }
    }

    return [{
        states: {
        },
        status: 'success',
        ids: deviceIds
    }];
}; //processEXECUTEActivateScene

async function processEXECUTESetModes(uid, reqId, cmd, event) {

    let deviceIds = [];
    let retArr = [];
    
    for (d of cmd.devices) {
        let device = await utils.loadDevice(uid, d.customData.device);
        if (!device)
            return handleUnsupportedOperation();

    		log.info(event.params.updateModeSettings);
    		for (mode of Object.keys(event.params.updateModeSettings)) {
    			let value = event.params.updateModeSettings[mode];
    			for (mappingMode of device.mappings.Modes) {
    				if (mappingMode.mode_attributes.name === mode) {
    					await execFHEMCommand(uid, reqId, device, mappingMode, value);

    					let ret = {
    						states: {
    							currentModeSettings: {
    							}
    						},
    						status: 'SUCCESS',
    						ids: [d.id]
    					};
    					ret.states.currentModeSettings[mode] = value;
    					retArr.push(ret);
    				}
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
                uiderror(uid, mapping.informId + ' homekit2reading: ' + err);
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
                cmd = mapping.cmdOn
    
            else if (mapping.cmdOff !== undefined && value == 0)
                cmd = mapping.cmdOff
        
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
    await admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({msg: 'EXECUTE', id: reqId, cmd: command, connection: device.connection});
}

module.exports = {
  handleEXECUTE
};

