import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

/**
 * 專案已註冊 App Check（reCAPTCHA Enterprise）。
 * 若 Firestore / Auth 開啟 enforcement，沒有 token 的請求會被拒絕。
 */
export function setupAppCheck(app: FirebaseApp): AppCheck | null {
  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (!siteKey) {
    console.warn('[app-check] 未設定 VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');
    return null;
  }

  const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  if (debugToken) {
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken;
  }

  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
