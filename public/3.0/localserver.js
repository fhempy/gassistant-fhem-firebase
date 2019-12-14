const express = require('express');
const localEXECUTE = require('./localhandleEXECUTE');
const database = require('./database');

const PORT = 3000;

var bonjour = require('bonjour')();
// advertise an HTTP server on port PORT
var srv = bonjour.publish({ name: 'fhemconnect', type:'http', port: PORT, txt:{httpPath:'/fhemconnect/local',httpSSL:false,httpPort:PORT,version:'1.0'}});
srv.start();


var app = express();

app.use(express.json());

app.post('/fhemconnect/local', async function (req, res) {
  console.log('LOCAL received:' + JSON.stringify(req.body));
  
  if (req.body.inputs[0].intent == "action.devices.IDENTIFY") {
    var resp = {
      requestId: req.body.requestId,
      payload: {
        device: {
          id: 'fhemconnect-id',
          isLocalOnly: true,
          isProxy: true,
          deviceInfo: {
            hwVersion: "UNKNOWN_HW_VERSION",
            manufacturer: "FHEM Connect",
            model: "FHEM Connect",
            swVersion: "1.0"
          }
        }
      },
      intenet: "action.devices.IDENTIFY"
    };

    res.send(resp);
  } else if (req.body.inputs[0].intent == "action.devices.REACHABLE_DEVICES") {
    var verifiedDevices = [];
    req.body.devices.forEach(d => {
      if (typeof d.customData.device !== 'undefined') {
        verifiedDevices.push({verificationId: d.id});
      }
    });
    
    var resp = {
      requestId: req.body.requestId,
      payload: {
        devices: verifiedDevices
      },
      intent: "action.devices.REACHABLE_DEVICES"
    };
    
    res.send(resp);
  } else if (req.body.inputs[0].intent == "action.devices.EXECUTE") {
    localEXECUTE.handleEXECUTE(database.getUid(), req.body.requestId, res, req.body.inputs[0]);
  } else {
    //FIXME
    res.send("ERROR");
  }
});

app.listen(PORT, "0.0.0.0", function () {
  console.log('FHEM Connect Google local home server running on port 3000!');
});
