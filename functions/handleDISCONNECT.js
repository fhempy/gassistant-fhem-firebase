const admin = require("firebase-admin");
const functions = require("firebase-functions");
const utils = require('./utils');

const uidlog = require('./logger').uidlog;


async function setDisconnected(uid) {
  await admin.firestore().collection(uid).doc('state').set({disconnected: 1}, {merge: true});
};

async function handleDISCONNECT(uid, reqId, res) {
  await setDisconnected(uid);
  res.send({});
  //await deleteUserCollection(uid);
  //await deleteHomegraph(uid);
  //https://firebase.google.com/docs/firestore/solutions/delete-collections
}

async function deleteUserCollection(uid) {
  var batch = database.db.batch();
  //generate traits in firestore
  var ref = await admin.firestore().collection(uid).doc('devices').collection('devices').get();
  for (var r of ref.docs) {
    batch.delete(r.ref);
  }
  ref = await admin.firestore().collection(uid).doc('devices').collection('attributes').get();
  for (var r of ref.docs) {
    batch.delete(r.ref);
  }
  ref = await admin.firestore().collection(uid).doc('devices').collection('informids').get();
  for (var r of ref.docs) {
    batch.delete(r.ref);
  }
  
  await batch.commit();
}

async function deleteHomegraph(uid) {
  var google_token = await utils.getGoogleToken();
  if (!google_token)
    google_token = await utils.retrieveGoogleToken(uid);
    
  uidlog(uid, 'google token: ' + google_token);
  
  //report state
  const fetch = require('node-fetch');
  for (var i=0; i<2; i++) {
    var options = { method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + google_token,
        'X-GFE-SSL': 'yes',
        'Content-Type': 'application/json'
      }
    };
    const deleteRes = await fetch('https://homegraph.googleapis.com/v1/{' + uid + '=agentUsers/**}', options);
    uidlog(uid, 'deletehomegraphres: ' + deleteRes.status);
    
    if (deleteRes.status == 401) {
      google_token = await utils.retrieveGoogleToken(uid);
    } else {
      //save the token to database
      uidlog(uid, 'homegraph DELETED from uid=' + uid);
      await utils.setGoogleToken(google_token);
      break;
    }
  }
}

module.exports = {
  handleDISCONNECT
};
