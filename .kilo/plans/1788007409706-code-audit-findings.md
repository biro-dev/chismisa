# Code Audit Findings

## Overview
Comprehensive audit of the Chismisa codebase identifying bugs, dead code, and issues needing attention — including issues an app user would actually encounter and report.

---

## User-Reported Bugs (What Users Would Complain About)

### User Bug 1: "I clicked an invite link and nothing happened"
**Severity**: Medium
**File**: `src/app/join/[code]/page.tsx:23` → `src/app/page.tsx`

**Issue**: Join page redirects to `/?error=invalid-code` for invalid codes, but the home page never reads or displays the `error` searchParam. Users see their normal chat with no indication of what went wrong.

**Impact**: Confusing UX — users with expired/broken invite links get silently dumped back to their chat with no feedback.

**Fix**: Read `error` searchParam in `src/app/page.tsx` and display a toast/alert. Example:
```tsx
const { group, error } = await searchParams;
if (error === "invalid-code") {
  // Trigger toast: "This invite link is invalid or has expired."
}
```

---

### User Bug 2: "I tried to log in but it said my password was wrong"
**Severity**: Medium
**File**: `src/components/login-form.tsx:73` + `src/lib/actions/auth.ts:28`

**Issue**: Password input has `minLength={4}` (HTML validation), but server requires 8+ chars. Users with 4-7 char passwords pass client validation, submit, then get a confusing server error.

**Impact**: Wasted round-trip, confusing error message, potential account lockout frustration.

**Fix**: Change `minLength={4}` → `minLength={8}` in login-form.tsx.

---

### User Bug 3: "Messages sometimes appear twice after I send them"
**Severity**: High
**File**: `src/lib/hooks/use-chat.ts` (optimistic send + poll race)

**Issue**: When a user sends a message, it's added optimistically. If the 30s poll fetches the confirmed message *before* the action resolves, the deduplication logic tries to reconcile but has edge cases:
- The poll's `data` array includes the confirmed message
- `optimisticMessageIdsRef.current.has(m.id)` filters by the *temp* ID, not the server ID
- The confirmed message passes through as "new" because its server ID isn't in `optimisticMessageIdsRef`

**Impact**: Brief duplicate messages that may or may not self-clean on next poll.

**Fix**: Track the mapping from temp ID → server ID when the action resolves, and filter by server ID in subsequent polls.

---

### User Bug 4: "My unread badge is wrong / doesn't update"
**Severity**: Medium
**File**: `src/components/dashboard.tsx:145-175` (polling), `src/lib/realtime.ts` (Pusher badges)

**Issue**: Unread badges rely on two mechanisms:
1. 30s polling of `/api/groups` (slow, batched)
2. Real-time Pusher events (instant, but only if connected)

When switching groups, the badge is zeroed locally before the server confirms. If the user switches back quickly, they may see a stale badge. Also, if Pusher disconnects silently, badges stop updating until next poll.

**Impact**: Users think they have unread messages when they don't, or miss unread indicators.

**Fix**: Add a "last viewed timestamp" that persists across group switches, or force-refresh badges when switching back to a group.

---

### User Bug 5: "The app gets really slow when I have multiple tabs open"
**Severity**: Medium
**File**: `src/lib/hooks/use-chat.ts` (polling effect)

**Issue**: The BroadcastChannel-based cross-tab coordination works in modern browsers, but:
- Falls back to per-tab polling if BroadcastChannel is unavailable (Safari private mode, older browsers)
- Each tab independently hits `/api/messages` every 30s

**Impact**: N tabs = N× polling frequency. With 5 tabs, that's a request every 6 seconds per user.

**Fix**: The BroadcastChannel implementation is already a good fix. Ensure the fallback is documented as a known limitation.

---

### User Bug 6: "I still see notifications after logging out"
**Severity**: High
**File**: `src/lib/realtime.ts:303-306`

**Issue**: `disconnectRealtime()` doesn't call `pusher.unsubscribe(name)` for DM channels, leaking subscriptions.

**Impact**: Users continue receiving push events for DM conversations even after logout, until the Pusher connection times out server-side.

**Fix**: Add `pusher.unsubscribe(name)` to the DM cleanup loop.

---

## Code-Level Bugs (Found in Review)

### Bug 1: Login Form `minLength` Mismatch
See User Bug 2 above.

---

### Bug 2: DM Channel Cleanup Leak
See User Bug 6 above.

---

### Bug 3: Module-Level Capacitor Plugin Check
**Severity**: Low
**File**: `src/components/message-bubble.tsx:12`

**Issue**: `Capacitor.isPluginAvailable("Haptics")` runs at module load time, not render time. In SSR or non-native environments, this could throw.

**Impact**: Potential SSR breakage.

**Fix**: Move check inside `useEffect` or make `triggerHaptic` check lazily.

---

## Dead Code

### None Found
All exports are referenced:
- `QUICK_EMOJIS`, `ALL_EMOJIS`, `searchEmojis` — used in `message-bubble.tsx`
- `useTransition`/`startTransition` — used in `use-chat.ts`
- `dmChannelStates` — used in DM subscription lifecycle

---

## Issues Needing Attention

### Issue 1: Search Results Lose Read Receipt Info
**Severity**: Low
**File**: `src/app/api/search/route.ts:86`

**Issue**: `seenCount: 0` hardcoded — users never see "Seen by N" in search results.

**Fix**: Compute `seenCount` from group member read states.

---

### Issue 2: `disconnectRealtime` References `dmChannelStates` Before Declaration
**Severity**: Low (code smell)
**File**: `src/lib/realtime.ts:303 vs :348`

**Issue**: Function uses a `const` declared 45 lines later. Works due to hoisting but reduces readability.

**Fix**: Reorder definitions.

---

### Issue 3: Login Form Has Duplicate React Import
**Severity**: Low
**File**: `src/components/login-form.tsx:3-5`

**Issue**: `useState` and `useEffect` imported from `react` on separate lines.

**Fix**: Consolidate imports.

---

## Implementation Order

1. **Fix login form `minLength`** — 1 line, immediate UX improvement
2. **Fix DM channel cleanup leak** — resource leak, affects all users
3. **Display invalid invite code error** — silent failure confuses users
4. **Fix optimistic message deduplication** — visible duplicate messages
5. **Move Capacitor check to lazy/effect** — SSR safety
6. **Compute search `seenCount`** — read receipt completeness
7. **Clean up declaration order + imports** — code hygiene

---

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run test
```