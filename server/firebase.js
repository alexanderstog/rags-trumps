const admin = require('firebase-admin');

if (!admin.apps.length) {
  const initOptions = {
    projectId: process.env.FIREBASE_PROJECT_ID || 'boards-6e600',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'boards-6e600.firebasestorage.app'
  };

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    initOptions.credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }
  // If no explicit credential is given, the Admin SDK falls back to
  // GOOGLE_APPLICATION_CREDENTIALS (a key file path) or, on Google infra,
  // Application Default Credentials automatically.

  admin.initializeApp(initOptions);
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

module.exports = { admin, db, bucket };
