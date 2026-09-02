# Fix Mobile Input Layout Issues

## Problem
Two related mobile UX issues:
1. **Textarea grows too tall**: In DMs, the `<textarea>` has `max-h-[120px]` which, combined with the send button, can exceed the visible area on small screens
2. **Keyboard hides input**: When the mobile keyboard opens, the input area (including send button) gets hidden behind the keyboard because `h-dvh` on some browsers (iOS Safari) includes the area behind the keyboard

## Root Causes

### Issue 1: Textarea too tall
**File**: `src/components/dm-view.tsx:190`
- `max-h-[120px]` is ~5 lines of text
- On a 375px iPhone with keyboard open, visible height is ~300px
- Header (56px) + messages area + textarea (120px) + send button (40px) + padding > 300px

### Issue 2: Keyboard covers input
**File**: `src/components/dashboard.tsx:401` + `src/app/layout.tsx`
- Dashboard uses `h-dvh` (dynamic viewport height)
- On iOS Safari, `100dvh` includes area behind the keyboard
- Body has `min-h-full` which can cause the page to extend behind the keyboard
- When keyboard opens, the input area stays at the bottom of the full viewport (behind keyboard)

## Fixes

### Fix 1: Reduce DM textarea max-height
**File**: `src/components/dm-view.tsx:190`

Change `max-h-[120px]` to `max-h-[60px]` (max ~2.5 lines on mobile). This prevents the textarea from consuming too much vertical space.

### Fix 2: Use small viewport height for base layout
**File**: `src/app/layout.tsx:50`

Change body from `min-h-full` to `h-dvh` to prevent the body from extending behind the keyboard:
```tsx
<body className="flex h-dvh flex-col bg-ink text-ink-text">
```

### Fix 3: Ensure dashboard handles keyboard properly
**File**: `src/components/dashboard.tsx:401`

The dashboard already uses `h-dvh`. Combined with Fix 2, this should work. But we also need to ensure the input area doesn't grow beyond available space.

### Fix 4: Add `interactiveViewport` support for iOS
**File**: `src/app/layout.tsx:37-42`

Add `interactiveViewport` to the viewport meta to help iOS handle the keyboard:
```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveViewport: true,  // Add this
  themeColor: "#0f0a1a",
};
```

## Validation

1. Open DM on a mobile device (or Chrome DevTools mobile emulation)
2. Type a multi-line message - textarea should grow to max ~60px, send button stays visible
3. Tap the input to open keyboard - input area should remain visible above the keyboard
4. Test on iOS Safari if possible (primary browser affected by `dvh` issue)
5. Test group chat input (single-line, should not be affected by textarea fix)

## Files to Modify
- `src/components/dm-view.tsx:190` - reduce textarea max-height
- `src/app/layout.tsx:50` - change body to use `h-dvh`
- `src/app/layout.tsx:37-42` - add `interactiveViewport` to viewport config