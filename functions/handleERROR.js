const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');

const uidlog = require('./logger').uidlog;

exports.handleERROR = async function handleERROR(uid, reqId, res, input, errorcode) {
  if (errorcode && errorcode.clientnotconnected) {
    res.send(utils.createDirective(reqId, {errorCode: 'deviceOffline'}));
  }
}
