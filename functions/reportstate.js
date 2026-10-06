const express = require('express');
const cors = require('cors');
const utils = require('./utils');
const uiderror = require('./logger').uiderror;

const app3 = express();
app3.use(cors());
app3.use(express.json({ limit: '10mb' }));
app3.use(express.urlencoded({ extended: true, limit: '10mb' }));
app3.use(utils.jwtCheck);
// no log per request, Cloud Run writes a request log anyway (report state is called very often)

app3.post('/singledevice_v2', async (req, res)  => {
  const {
    sub: uid
  } = req.user;
  const deviceStatus = req.body.deviceStatus;

  //reportstate
  try {
    await utils.reportStateWithData(uid, deviceStatus);
  } catch (err) {
    uiderror(uid, "Error in ReportState: " + err, err);
  }
  res.send({});
});

app3.post('/singledevice', async (req, res) => {
  const {
    sub: uid
  } = req.user;
  const device = req.body.device;

  //reportstate
  try {
    await utils.reportState(uid, device);
  } catch (err) {
    uiderror(uid, "Error in ReportState (" + device + "): " + err, err);
  }
  res.send({});
});

app3.get('/alldevices', async (req, res) => {
  const {
    sub: uid
  } = req.user;

  //reportstate all
  try {
    await utils.reportState(uid);
  } catch (err) {
    uiderror(uid, "Error in ReportState: " + err, err);
  }
  res.send({});
});


const reportstate = require('./https').onRequest('reportstate', 'us-central1', app3);

module.exports = {
  reportstate
};