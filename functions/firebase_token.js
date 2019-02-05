const bodyParser = require('body-parser');
const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');
const uidlog = require('./logger.js').uidlog;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

app.get('/token', utils.jwtCheck, (req, res) => {
  const {sub: uid} = req.user;
  uidlog(uid, 'firebase ' + JSON.stringify(req.user));
  try {
    admin.auth().createCustomToken(uid)
      .then(function(firebaseToken) {
        uidlog(uid, 'return firebase token: ' + firebaseToken);
        res.json({firebase_token: firebaseToken, uid: uid});
      });
  } catch (err) {
    res.status(500).send({
      message: 'Something went wrong acquiring a Firebase token.',
      error: err
    });
  }
});

const firebase = functions.region('europe-west1').https.onRequest(app);

module.exports = {
  firebase
};
