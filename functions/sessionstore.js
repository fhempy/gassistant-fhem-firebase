// express-session store in the Firebase Realtime Database
// (replaces connect-session-firebase, which only supports firebase-admin 11)
const session = require('express-session');

const DEFAULT_TTL = 86400000; // 1 day

function sanitize(sid) {
  return sid.replace(/[.#$\[\]\/]/g, '_');
}

class RealtimeDatabaseStore extends session.Store {
  constructor(options) {
    super();
    this.ref = options.database.ref(options.path || 'sessions');
  }

  get(sid, callback) {
    this.ref.child(sanitize(sid)).once('value').then(function (snap) {
      const val = snap.val();
      if (!val || val.expires < Date.now())
        return callback(null, null);
      callback(null, JSON.parse(val.sess));
    }, callback);
  }

  set(sid, sess, callback) {
    const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DEFAULT_TTL;
    this.ref.child(sanitize(sid)).set({
      sess: JSON.stringify(sess),
      expires: expires
    }).then(function () {
      if (callback) callback(null);
    }, function (err) {
      if (callback) callback(err);
    });
  }

  destroy(sid, callback) {
    this.ref.child(sanitize(sid)).remove().then(function () {
      if (callback) callback(null);
    }, function (err) {
      if (callback) callback(err);
    });
  }

  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }
}

module.exports = {
  RealtimeDatabaseStore
};
