const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const { getAuth } = require('firebase-admin/auth');
const utils = require('./utils');
const uidlog = require('./logger.js').uidlog;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/token', utils.jwtCheck, async (req, res) => {
  const {
    sub: uid
  } = req.user;
  uidlog(uid, 'firebase token requested');
  try {
    const firebaseToken = await getAuth().createCustomToken(uid);
    res.json({
      firebase_token: firebaseToken,
      uid: uid
    });
  } catch (err) {
    console.error(uid + ': createCustomToken failed', err);
    res.status(500).send({
      message: 'Something went wrong acquiring a Firebase token.'
    });
  }
});

const firebase = require('./https').onRequest('firebase', 'europe-west1', app);

module.exports = {
  firebase
};