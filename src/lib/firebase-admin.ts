// lib/firebase-admin.js
import admin from 'firebase-admin';

if (!admin.apps.length) {
  // Either provide a JSON string in FIREBASE_SERVICE_ACCOUNT (recommended)
  // or provide the three individual environment variables.
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // FIREBASE_SERVICE_ACCOUNT is JSON string (useful on Vercel)
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    // Note: if you store PRIVATE_KEY as a single-line with "\n", replace escaped newlines
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  } else {
    // Fallback: use GOOGLE_APPLICATION_CREDENTIALS (path to file on disk)
    admin.initializeApp();
  }
}

const db = admin.firestore();

export { admin, db };
