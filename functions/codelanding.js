const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const utils = require('./utils');
const admin = require("firebase-admin");
const functions = require("firebase-functions");

const app3 = express();
app3.use(cors());
app3.use(bodyParser.json());
app3.use(bodyParser.urlencoded({extended: true}));

app3.get('/start', (req, res) => {
  res.send('Your authentication code: ' + req.query.code);
});

const codelanding = functions.region('europe-west1').https.onRequest(app3);

module.exports = {
  codelanding
};
