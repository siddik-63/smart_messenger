import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD5eNi_9-oFLDiHtD9fDd2lLaCpZHIOZTg",
  authDomain: "smart-translator-96369.firebaseapp.com",
  projectId: "smart-translator-96369",
  storageBucket: "smart-translator-96369.firebasestorage.app",
  messagingSenderId: "747685243796",
  appId: "1:747685243796:web:7a8182161be589e25d3d81",
  measurementId: "G-FBJWKWR8DC"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
