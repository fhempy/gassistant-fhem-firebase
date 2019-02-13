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

    for (d of input.payload.devices) {
        let device;
        try {
          uidlog(uid, "QUERY: " + d.customData.device);
          device = await utils.loadDevice(uid, d.customData.device);
        } catch (err) {
          uiderror(uid, err);
          continue;
        }
        devices[d.id] = {};
		
        // If there is a current or a target temperature, we probably have a thermostat
        if (device.mappings.CurrentTemperature || device.mappings.TargetTemperature) {
            if (device.mappings.TargetTemperature) {
                const desiredTemp = parseFloat(await cached2Format(uid, device.mappings.TargetTemperature));
                let thermostatMode = 'heat';
                if (desiredTemp == device.mappings.TargetTemperature.minValue) {
                    thermostatMode = 'off';
                }
                devices[d.id].thermostatMode = thermostatMode;
                devices[d.id].thermostatTemperatureSetpoint = desiredTemp;
            } else {
                devices[d.id].thermostatMode = 'off';
            }
      			
      			if (device.mappings.CurrentTemperature) {
                const currentTemp = parseFloat(await cached2Format(uid, device.mappings.CurrentTemperature));
                devices[d.id].thermostatTemperatureAmbient = currentTemp;
            }

            if (device.mappings.CurrentRelativeHumidity) {
                devices[d.id].thermostatHumidityAmbient = parseFloat(await cached2Format(uid, device.mappings.CurrentRelativeHumidity));
            }
        }
		
		    //OnOff
		    if (device.mappings.On) {
		        var reachable = 1;
            const turnedOn = await cached2Format(uid, device.mappings.On);
            if (device.mappings.Reachable) {
              reachable = await cached2Format(uid, device.mappings.Reachable);
            }
            if (!reachable)
              devices[d.id].on = false;
            else
              devices[d.id].on = turnedOn;
        }
        
        //OpenClose
        if (device.mappings.OpenClose) {
          devices[d.id].openPercent = await cached2Format(uid, device.mappings.OpenClose);
        }
		
        //action.devices.traits.Modes: STATES
        if (device.mappings.Modes) {
            devices[d.id].currentModeSettings = {};
            for (mode of device.mappings.Modes) {
                let currentMode = await cached2Format(uid, mode);
        		    devices[d.id].currentModeSettings[mode.mode_attributes.name] = currentMode;
            }
        }
        
        //action.devices.traits.Toggles
        if (device.mappings.Toggles) {
            devices[d.id].currentToggleSettings = {};
            for (toggle of device.mappings.Toggles) {
                let currentToggle = await cached2Format(uid, toggle);
        		    devices[d.id].currentToggleSettings[toggle.toggle_attributes.name] = currentToggle == toggle.valueOn;
            }
        }
        
        //action.devices.traits.FanSpeed
        if (device.mappings.FanSpeed) {
            devices[d.id].currentFanSpeedSetting = await cached2Format(uid, device.mappings.FanSpeed);
        }
        
        //action.devices.traits.Dock
        if (device.mappings.Dock) {
            devices[d.id].isDocked = await cached2Format(uid, device.mappings.Dock);
        }
        
        //action.devices.traits.ColorSetting
        if (device.mappings.RGB) {
            devices[d.id].color = {};
            const rgb = await cached2Format(uid, device.mappings.RGB);
            if (device.mappings.ColorMode) {
              const colormode = await cached2Format(uid, device.mappings.ColorMode);
              if (colormode == device.mappings.ColorMode.valueCt) {
                  //color temperature mode
                  devices[d.id].color.temperatureK = await cached2Format(uid, device.mappings.ColorTemperature);
              } else {
                  //RGB mode
                  if (reportstate) {
                    devices[d.id].color.spectrumRGB = await cached2Format(uid, device.mappings.RGB);
                  } else {
                    devices[d.id].color.spectrumRgb = await cached2Format(uid, device.mappings.RGB);
                  }
              }
            } else {
              //RGB mode
              if (reportstate) {
                devices[d.id].color.spectrumRGB = await cached2Format(uid, device.mappings.RGB);
              } else {
                devices[d.id].color.spectrumRgb = await cached2Format(uid, device.mappings.RGB);
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
            devices[d.id].brightness = await cached2Format(uid, device.mappings.Brightness);
        }
        
        //action.devices.traits.StartStop
        if (device.mappings.StartStop) {
            devices[d.id].isPaused = await cached2Format(uid, device.mappings.StartStop) == 'paused' ? true : false;
            devices[d.id].isRunning = await cached2Format(uid, device.mappings.StartStop) == 'running' ? true : false;
        }
        
        //if a trait was used, set online, otherwise delete (e.g. scene)
        if (Object.keys(devices[d.id]).length) {
          devices[d.id].online = true;
        } else {
          delete devices[d.id];
        }
    }
    uidlog(uid, 'processQUERY: ' + JSON.stringify(devices));

    return {devices: devices};
} //processQUERY


function FHEM_reading2homekit_(uid, mapping, orig) {
    var value = orig;
    if (value === undefined)
        return undefined;
    var reading = mapping.reading;

    if (reading == 'temperature'
        || reading == 'measured'
        || reading == 'measured-temp'
        || reading == 'desired-temp'
        || reading == 'desired'
        || reading == 'desiredTemperature') {
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

    } else if (reading == 'pct') {
        value = parseInt(value);

    } else if (reading == 'reachable') {
        value = parseInt(value);
        
    } else if (mapping.characteristic_type == 'OpenClose') {
        value = mapping.valueClosed == value ? 0 : 100;

    } else if (reading === 'state' && ( mapping.On
            && typeof mapping.values !== 'object'
            && mapping.reading2homekit === undefined
            && mapping.valueOn === undefined && mapping.valueOff === undefined)) {
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

        var orig = value;

        var format = undefined;
        if (typeof mapping.characteristic === 'object')
            format = mapping.characteristic.props.format;
        else if (typeof mapping.characteristic === 'function') {
            var characteristic = new (Function.prototype.bind.apply(mapping.characteristic, arguments));

            format = characteristic.props.format;

            //delete characteristic;
        } else if (mapping.format) { // only for testing !
            format = mapping.format;

        }

        if (mapping.event_map !== undefined) {
            var mapped = mapping.event_map[value];
            if (mapped !== undefined) {
                console.debug(mapping.informId + ' eventMap: value ' + value + ' mapped to: ' + mapped);
                value = mapped;
            }
        }

        if (value !== undefined && mapping.part !== undefined) {
            var mapped = value.split(' ')[mapping.part];

            if (mapped === undefined) {
                uiderror(uid, mapping.informId + ' value ' + value + ' has no part ' + mapping.part);
                return value;
            }
            console.debug(mapping.informId + ' parts: using part ' + mapping.part + ' of: ' + value + ' results in: ' + mapped);
            value = mapped;
        }

        if (mapping.threshold) {
            //if( !format.match( /bool/i ) && mapping.threshold ) {
            var mapped;
            if (parseFloat(value) > mapping.threshold)
                mapped = 1;
            else
                mapped = 0;
            console.debug(mapping.informId + ' threshold: value ' + value + ' mapped to ' + mapped);
            value = mapped;
        }

        if (typeof mapping.value2homekit_re === 'object' || typeof mapping.value2homekit === 'object') {
            var mapped = undefined;
            if (typeof mapping.value2homekit_re === 'object')
                for (var entry of mapping.value2homekit_re) {
                    if (value.match(entry.re)) {
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
                uiderror(uid, mapping.informId + ' value ' + value + ' not handled in values');
                return undefined;
            }
            
            if (mapped == 'true' || mapped == 'false') {
              mapped = (mapped == 'true');
            }

            console.debug(mapping.informId + ' values: value ' + value + ' mapped to ' + mapped);
            value = mapped;
        }

        if (!format) {
            uidlog(uid, mapping.informId + ' empty format, using ' + value);
            return value;
        } else if (format.match(/bool/i)) {
            var mapped = undefined;
            ;
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
                console.debug(mapping.informId + ' valueOn/valueOff: value ' + value + ' mapped to ' + mapped);
                value = mapped;
            }

            if (mapping.factor) {
                console.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
                value *= mapping.factor;
            }

            if (mapping.invert) {
                mapping.minValue = 0;
                mapping.maxValue = 1;
            }

        } else if (format.match(/float/i)) {
            var mapped = parseFloat(value);

            if (typeof mapped !== 'number') {
                uiderror(uid, mapping.informId + ' is not a number: ' + value);
                return undefined;
            }
            value = mapped;

            if (mapping.factor) {
                console.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
                value *= mapping.factor;
            }

        } else if (format.match(/int/i)) {
            var mapped = parseFloat(value);

            if (typeof mapped !== 'number') {
                uiderror(uid, mapping.informId + ' not a number: ' + value);
                return undefined;
            }
            value = mapped;

            if (mapping.factor) {
                console.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
                value *= mapping.factor;
            }

            value = parseInt(value + 0.5);
        } else if (format.match(/string/i)) {
        }


        if (mapping.max && mapping.maxValue) {
            value = Math.round((value * mapping.maxValue / mapping.max)*100)/100;
            console.debug(mapping.informId + ' value ' + orig + ' scaled to: ' + value);
        }

        if (mapping.minValue !== undefined && value < mapping.minValue) {
            console.debug(mapping.informId + ' value ' + value + ' clipped to minValue: ' + mapping.minValue);
            value = mapping.minValue;
        } else if (mapping.maxValue !== undefined && value > mapping.maxValue) {
            console.debug(mapping.informId + ' value ' + value + ' clipped to maxValue: ' + mapping.maxValue);
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
                uiderror(uid, mapping.informId + ' not a number: ' + orig);
                return undefined;
            } else if (mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined) {
                mapped = mapping.maxValue - value + mapping.minValue;
            } else if (mapping.invert && mapping.maxValue !== undefined) {
                mapped = mapping.maxValue - value;
            } else if (mapping.invert) {
                mapped = 100 - value;
            }

            if (value !== mapped)
                console.debug(mapping.informId + ' value: ' + value + ' inverted to ' + mapped);
            value = mapped;
        }
        if (format && format.match(/bool/i)) {
            value = parseInt(value) ? true : false;
        }
    }

    return value;
}

function FHEM_reading2homekit(uid, mapping, orig) {
    var value = undefined;
    if (mapping.reading2homekit && typeof mapping.reading2homekit == 'function') {
        uidlog(uid, 'function found for reading2homekit');
        try {
            value = mapping.reading2homekit(mapping, orig);
        } catch (err) {
            uiderror(uid, mapping.informId + ' reading2homekit: ' + err);
            return undefined;
        }
        if (typeof value === 'number' && isNaN(value)) {
            uiderror(uid, mapping.informId + ' not a number: ' + orig + ' => ' + value);
            return undefined;
        }

    } else {
        value = FHEM_reading2homekit_(uid, mapping, orig);
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

    uidlog(uid, '    caching: ' + (mapping.name ? 'Custom ' + mapping.name : mapping.characteristic_type) + (mapping.subtype ? ':' + mapping.subtype : '') + ': '
        + value + ' (' + 'as ' + typeof(value) + (defined ? '; means ' + defined : '') + '; from \'' + orig + '\')');
    mapping.cached = value;

    return value;
}

async function cached2Format(uid, mapping) {
    var val = await utils.getInformId(uid, mapping.informId);
    return FHEM_reading2homekit(uid, mapping, val);
}

module.exports = {
  handleQUERY,
  processQUERY
};
