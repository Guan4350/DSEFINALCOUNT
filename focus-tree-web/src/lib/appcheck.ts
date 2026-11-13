import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';

/**
 * App Check（reCAPTCHA Enterprise）。
 * 必須在 initializeApp 之後、任何 callable 之前執行。
 * 本機開發若未設定 site key，可用 debug token；正式環境一定要填 site key。
 */
export function setupAppCheck(app: FirebaseApp): AppCheck | null {
  const siteKey =
    import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    console.warn(
      '[app-check] 未設定 VITE_RECAPTCHA_ENTERPRISE_SITE_KEY；若 Cloud Functions 已啟用 App Check enforcement，callable 會被拒絕。',
    );
    return null;
  }

  if (import.meta.env.DEV) {
    const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken || true;
  }

  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
