import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);
export default app;