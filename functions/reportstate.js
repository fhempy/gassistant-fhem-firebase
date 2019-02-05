const utils = require('./utils');
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const uidlog = require('./logger').uidlog;

const reportstate = functions.region('europe-west1').firestore.document('{uid}/devices/informids/{informid}').onUpdate(async (change, context) => {

  var uid = context.params.uid;
  var informid = context.params.informid;
  
  await utils.reportState(uid, informid);
});

module.exports = {
  reportstate
};
