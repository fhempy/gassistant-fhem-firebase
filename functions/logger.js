
function uidlog(uid, msg) {
  //console.log(uid + ': ' + msg);
}

function uidlogfct(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uiderror(uid, msg) {
  console.error(new Error(uid + ': ' + msg));
  //admin.firestore().collection(uid).doc('msgs').collection('firestore2fhem').add({'msg': 'LOG_ERROR', log: msg});
}

module.exports = {
  uidlog,
  uiderror,
  uidlogfct
}
