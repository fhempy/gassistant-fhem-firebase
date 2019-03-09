const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const utils = require('./utils');
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const uidlog = require('./logger').uidlog;
const uiderror = require('./logger').uiderror;
const hquery = require('./handleQUERY');

const app3 = express();
app3.use(cors());
app3.use(bodyParser.json());
app3.use(bodyParser.urlencoded({extended: true}));
app3.use(utils.jwtCheck);
app3.use(function(req, res, next) {
  const {sub: uid} = req.user;
  uidlog(uid, 'Function called: ' + req.originalUrl);
  next();
});

app3.post('/singledevice', async (req, res) => {
  const {sub: uid} = req.user;
  const device = req.body.device;

  //reportstate
  await utils.reportState(uid, device);
  res.send({});
});

app3.get('/alldevices', async (req, res) => {
  const {sub: uid} = req.user;
  const device = req.body.device;

  //reportstate all
  await utils.reportState(uid);
  res.send({});
});


const reportstate = functions.region('europe-west1').https.onRequest(app3);

module.exports = {
  reportstate
};
