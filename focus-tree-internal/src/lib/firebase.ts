import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { setupAppCheck } from './appcheck';

const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  throw new Error(`缺少 Firebase Web 設定：${missing.join(', ')}`);
}

export const app = initializeApp(config);
export const appCheck = setupAppCheck(app);
export const auth = getAuth(app);
export const db = getFirestore(app);

void setPersistence(auth, browserLocalPersistence).catch(error => {
  console.warn('[focus-tree] 無法設定登入持久化', error);
});
