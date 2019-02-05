
function uidlog(uid, msg) {
  console.log(uid + ': ' + msg);
}

function uiderror(uid, msg) {
  console.error(uid + ': ' + msg);
}

module.exports = {
  uidlog,
  uiderror
};
