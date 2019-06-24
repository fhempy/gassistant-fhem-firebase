const admin = require("firebase-admin");

function uidlog(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uidlogfct(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uiderror(uid, msg, err) {
  admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({'msg': 'LOG_ERROR', log: msg.toString(), ts: Date.now()});
  
  if ((msg instanceof Error) === false)
    msg = new Error(msg);
  console.error(uid + ': ' + msg);

  if(err)
    console.error(err);
}

module.exports = {
  uidlog,
  uiderror,
  uidlogfct
}
