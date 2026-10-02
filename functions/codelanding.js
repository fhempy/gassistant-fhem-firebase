const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const utils = require('./utils');
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

const app3 = express();
app3.use(cors());
app3.use(express.json({ limit: '10mb' }));
app3.use(express.urlencoded({ extended: true, limit: '10mb' }));

app3.get('/start', (req, res) => {
  res.send('Your authentication code: ' + req.query.code);
});

const codelanding = functions.region('europe-west1').https.onRequest(app3);

module.exports = {
  codelanding
};