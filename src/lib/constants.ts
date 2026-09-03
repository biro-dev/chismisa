/**
 * App-wide constants. Centralizing magic numbers improves maintainability
 * and makes the codebase easier to reason about.
 */

// ─── Message limits ──────────────────────────────────────────────────────────
export const MESSAGE_MAX_LENGTH = 2000;
export const GROUP_NAME_MAX_LENGTH = 50;
export const GROUP_NAME_MIN_LENGTH = 1;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 8;

// ─── Polling & realtime ─────────────────────────────────────────────────────
export const POLL_INTERVAL_MS = 30_000;
export const TYPING_DEBOUNCE_MS = 2000;
export const TYPING_TIMEOUT_MS = 3000;
export const READ_RECEIPT_THROTTLE_MS = 5_000;
export const REALTIME_HEARTBEAT_MS = 30_000;
export const PRESENCE_OFFLINE_THRESHOLD_MS = 60_000;

// ─── Gestures ───────────────────────────────────────────────────────────────
export const LONG_PRESS_MS = 450;
export const SWIPE_TRIGGER_PX = 60;
export const SCROLL_NEAR_BOTTOM_PX = 100;
export const LOAD_OLDER_THRESHOLD_PX = 50;
export const MAX_SWIPE_OFFSET_PX = 110;

// ─── Pagination ─────────────────────────────────────────────────────────────
export const MESSAGES_PAGE_SIZE = 50;
export const SEARCH_PAGE_SIZE = 30;
export const MAX_MESSAGES_IN_MEMORY = 500;

// ─── UI ─────────────────────────────────────────────────────────────────────
export const TOAST_DURATION_MS = 3_500;
export const MAX_UNREAD_BADGE = 99;
export const OVERLAY_CLOSE_DELAY_MS = 2_200;

// ─── Rate limiting ──────────────────────────────────────────────────────────
export const RATE_LIMIT_GROUPS = 120;
export const RATE_LIMIT_MESSAGES = 240;
export const RATE_LIMIT_SEARCH = 30;
export const RATE_LIMIT_DEVICES = 30;
export const RATE_LIMIT_TYPING = 60;
export const RATE_LIMIT_PUSHER_AUTH = 60;
export const RATE_LIMIT_DM_MESSAGES = 240;

// ─── Security ───────────────────────────────────────────────────────────────
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_RENEW_THRESHOLD_MS = SESSION_MAX_AGE_MS / 2;

// ─── Search debounce ────────────────────────────────────────────────────────
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
