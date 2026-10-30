export interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT: string;
  CALDAV_ENC_KEY: string;
  STATE_SECRET: string;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  WEBHOOK_BASE_URL?: string;
  ALLOWED_CALDAV_HOSTS?: string;
}

export interface FirebaseUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

export type CalendarProvider = 'caldav' | 'google';

export interface CalendarConnection {
  provider: CalendarProvider;
  label: string;
  url?: string;
  username?: string;
  secretCipher?: string;
  calendarUrl?: string;
  calendarName?: string;
  refreshCipher?: string;
  calendarId?: string;
  syncToken?: string;
  ctag?: string;
  channelId?: string;
  channelResourceId?: string;
  channelExpiration?: string;
  lastSyncAt?: string;
  nextSyncAt?: string;
  status?: 'idle' | 'syncing' | 'ok' | 'error';
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export type FirestoreValue =
  | { nullValue: null }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export interface RemoteEvent {
  uid: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  description?: string;
  location?: string;
  rrule?: string;
  updatedAt: string;
  href?: string;
  etag?: string;
}

export interface SyncSummary {
  provider: CalendarProvider;
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: number;
  skipped: number;
}
