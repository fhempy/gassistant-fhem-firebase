const { getFirestore } = require('firebase-admin/firestore');

function uidlog(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uidlogfct(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uiderror(uid, msg, err) {
  getFirestore().collection(uid).doc('msgs').collection('firestore2fhem').add({
    'msg': 'LOG_ERROR',
    log: msg.toString(),
    ts: Date.now()
  }).catch(function (err) {
    console.error(uid + ': failed to send LOG_ERROR to client', err);
  });

  var errMsg = uid + ": " + msg;
  if (err)
    errMsg = errMsg + "\n" + err.stack;

  var errObj = new Error(errMsg);
  console.error(errObj);
}

module.exports = {
  uidlog,
  uiderror,
  uidlogfct
}