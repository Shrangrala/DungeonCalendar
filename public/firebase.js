import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signOut as firebaseSignOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCRSwIQxC_gpic-Z4o0Rb6mPhkf1yBguGI',
  authDomain: 'dungeon-calendar-app.firebaseapp.com',
  projectId: 'dungeon-calendar-app',
  storageBucket: 'dungeon-calendar-app.firebasestorage.app',
  messagingSenderId: '1089961645011',
  appId: '1:1089961645011:web:07da2f00587b54d41e5526',
  measurementId: 'G-YRP7187GYT'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export { onAuthStateChanged };

export async function signInToFirebaseWithGoogleIdToken(idToken) {
  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}

export async function signOut() {
  return firebaseSignOut(auth);
}

export default app;
