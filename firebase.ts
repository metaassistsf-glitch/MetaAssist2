import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDocFromCache, getDocFromServer } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import firebaseConfigStatic from './firebase-applet-config.json';

const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfigStatic.projectId;
const isUsingStaticProject = projectId === firebaseConfigStatic.projectId;

// Use environment variables (injected via Vite) if available, otherwise fall back to static config
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || firebaseConfigStatic.apiKey,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || firebaseConfigStatic.authDomain,
  projectId: projectId,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || firebaseConfigStatic.storageBucket,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || firebaseConfigStatic.messagingSenderId,
  appId: process.env.FIREBASE_APP_ID || firebaseConfigStatic.appId,
  firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || (isUsingStaticProject ? firebaseConfigStatic.firestoreDatabaseId : '(default)')
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export async function testConnection() {
  try {
    // Try to get a non-existent doc from server to test connectivity
    await getDocFromServer(doc(db, '_connection_test_', 'test'));
    console.log("✅ Firebase connection test successful");
  } catch (error: any) {
    if (error.message?.includes('the client is offline')) {
      console.error("❌ Firebase connection failed: The client is offline. Please check your Firebase configuration.");
    } else {
      // Other errors are fine for a connection test (e.g. permission denied if we didn't allow read on this path)
      console.log("ℹ️ Firebase connection test completed (may have expected permission errors)");
    }
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
