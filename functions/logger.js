const admin = require("firebase-admin");

function uidlog(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uidlogfct(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uiderror(uid, msg, err) {
  admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({
    'msg': 'LOG_ERROR',
    log: msg.toString(),
    ts: Date.now()
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