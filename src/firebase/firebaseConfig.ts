import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBGFuP0FsnoqnGc8ujdwPSlMKIXDDzu0EA",
  authDomain: "mygrade-6bb6b.firebaseapp.com",
  projectId: "mygrade-6bb6b",
  storageBucket: "mygrade-6bb6b.firebasestorage.app",
  messagingSenderId: "243044846823",
  appId: "1:243044846823:web:d78d0d275160ae97d16642",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);