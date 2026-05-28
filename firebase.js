// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCRSwIQxC_gpic-Z4o0Rb6mPhkf1yBguGI",
  authDomain: "dungeon-calendar-app.firebaseapp.com",
  projectId: "dungeon-calendar-app",
  storageBucket: "dungeon-calendar-app.firebasestorage.app",
  messagingSenderId: "575544890085",
  appId: "1:1089961645011:web:07da2f00587b54d41e5526"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);