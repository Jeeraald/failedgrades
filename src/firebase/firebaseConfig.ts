import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: "AIzaSyBGFuP0FsnoqnGc8ujdwPSlMKIXDDzu0EA",
  authDomain: "mygrade-6bb6b.firebaseapp.com",
  projectId: "mygrade-6bb6b",
  storageBucket: "mygrade-6bb6b.firebasestorage.app",
  messagingSenderId: "243044846823",
  appId: "1:243044846823:web:d78d0d275160ae97d16642",
};

const app = initializeApp(firebaseConfig);

// Log a debug token in dev — add it to Firebase Console > App Check > Manage debug tokens
if (import.meta.env.DEV) {
  (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY as string),
  isTokenAutoRefreshEnabled: true,
});

// Enable IndexedDB-backed offline persistence so Firestore reads/writes
// continue to work while the device has no internet connection.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export const auth = getAuth(app);
export const storage = getStorage(app);