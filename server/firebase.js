const admin = require('firebase-admin');

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return null;
}

if (!admin.apps.length) {
  const initOptions = {
    projectId: process.env.FIREBASE_PROJECT_ID || 'boards-6e600',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'boards-6e600.firebasestorage.app'
  };

  try {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) {
      initOptions.credential = admin.credential.cert(serviceAccount);
    }
    // If no explicit credential is given, the Admin SDK falls back to
    // GOOGLE_APPLICATION_CREDENTIALS (a key file path) or, on Google infra,
    // Application Default Credentials automatically.
    admin.initializeApp(initOptions);
  } catch (err) {
    console.error('Failed to initialize Firebase Admin SDK:', err.message);
    throw err;
  }
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

module.exports = { admin, db, bucket };
