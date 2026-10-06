const express = require('express');
const cors = require('cors');
const jsonwt = require('jsonwebtoken');
const utils = require('./utils');

const app3 = express();
app3.use(cors());
app3.use(express.json({ limit: '10mb' }));
app3.use(express.urlencoded({ extended: true, limit: '10mb' }));

app3.get('/start', (req, res) => {
  res.send('Your authentication code: ' + req.query.code);
});

const codelanding = require('./https').onRequest('codelanding', 'europe-west1', app3);

module.exports = {
  codelanding
};