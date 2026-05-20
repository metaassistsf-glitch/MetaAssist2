require('dotenv').config();
const admin = require('firebase-admin');

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    })
  });
}

const db = admin.firestore();

async function run() {
  const collections = await db.listCollections();
  console.log('Collections:', collections.map(c => c.id));
  
  const snapshot = await db.collection('releaseNotes').get();
  console.log('releaseNotes count:', snapshot.size);
  snapshot.forEach(doc => console.log(doc.id, doc.data()));
}

run().catch(console.error);
