const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const utils = require('./utils');
const admin = require("firebase-admin");
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const hquery = require('./handleQUERY');

const app3 = express();
app3.use(cors());
app3.use(express.json({ limit: '10mb' }));
app3.use(express.urlencoded({ extended: true, limit: '10mb' }));
app3.use(utils.jwtCheck);
app3.use(function (req, res, next) {
  const {
    sub: uid
  } = req.user;
  uidlog(uid, 'Function called: ' + req.originalUrl);
  next();
});

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