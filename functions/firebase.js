// Firebase Admin SDK, loaded on first use.
// Loading Firestore and the Realtime Database takes most of the startup time of a function
// (and the startup time is billed). Report state doesn't need them for most requests.
let app;

function ensureApp() {
  if (!app) {
    const { initializeApp, getApps } = require('firebase-admin/app');
    // project configuration is provided by the Cloud Functions environment
    app = getApps().length ? getApps()[0] : initializeApp();
  }
  return app;
}

function getFirestore() {
  ensureApp();
  return require('firebase-admin/firestore').getFirestore();
}

function getDatabase() {
  ensureApp();
  return require('firebase-admin/database').getDatabase();
}

function getAuth() {
  ensureApp();
  return require('firebase-admin/auth').getAuth();
}

module.exports = {
  getFirestore,
  getDatabase,
  getAuth
};
