const admin = require("firebase-admin");

function uidlog(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uidlogfct(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uiderror(uid, msg) {
  admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({'msg': 'LOG_ERROR', log: msg.toString()});
  console.error(uid + ': ' + msg);
}

module.exports = {
  uidlog,
  uiderror,
  uidlogfct
}
