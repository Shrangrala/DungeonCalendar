import { initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCRSwIQxC_gpic-Z4o0Rb6mPhkf1yBguGI",
  authDomain: "dungeon-calendar-app.firebaseapp.com",
  projectId: "dungeon-calendar-app",
  storageBucket: "dungeon-calendar-app.firebasestorage.app",
  messagingSenderId: "1089961645011",
  appId: "1:1089961645011:web:07da2f00587b54d41e5526",
  measurementId: "G-YRP7187GYT"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Firebase auth persistence setup failed:", error);
});
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});
export const storage = getStorage(app);
export default app;