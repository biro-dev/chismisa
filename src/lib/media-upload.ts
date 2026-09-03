"use client";

import { getFirebaseStorage } from "./firebase-client";
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from "firebase/storage";

/** Kind of media attached to a message. */
export type MediaDraftType = "image" | "video" | "voice";

/**
 * Handle for an in-flight (or finished) media upload. Lets the composer show
 * live progress, cancel the upload, and lets the send path await the final
 * download URL — Messenger-style: the message appears instantly and the
 * upload finishes in the background.
 */
export type UploadHandle = {
  /** Resolves with the Firebase Storage download URL; rejects on failure/cancel. */
  promise: Promise<string>;
  /** Abort the upload. The promise rejects with a Firebase "canceled" error. */
  cancel: () => void;
  /** Latest known progress, 0–100. */
  getProgress: () => number;
  /** Subscribe to progress updates. Returns an unsubscribe function. */
  onProgress: (cb: (progress: number) => void) => () => void;
  /** True once the upload has resolved or rejected. */
  isSettled: () => boolean;
};

/**
 * A media attachment selected in the composer. The upload starts immediately
 * (in the background) so it is usually already done by the time the user hits
 * send — and if not, the send path simply awaits it.
 */
export type MediaDraft = {
  id: string;
  file: File;
  mediaType: MediaDraftType;
  mediaSize: number;
  mediaDuration: number | null;
  /** Local blob: URL — renders instantly in optimistic bubbles while uploading. */
  localUrl: string;
  handle: UploadHandle;
};

// Firebase Storage resumable uploads can hang indefinitely on flaky mobile
// connections. If no bytes move within this window, cancel the task so the
// promise rejects and the UI can offer a retry instead of spinning forever.
// Timeout is dynamic based on file size: larger files get more time.
// Base timeout: 2 minutes, plus 1 second per 100KB of file size.
const getStallTimeoutMs = (fileSize: number): number => {
  const BASE_TIMEOUT_MS = 120_000; // 2 minutes base
  const SIZE_TIMEOUT_MS = Math.ceil(fileSize / (100 * 1024)) * 1000; // 1s per 100KB
  return BASE_TIMEOUT_MS + SIZE_TIMEOUT_MS;
};

/**
 * Start uploading a file to Firebase Storage under media/{userId}/… and
 * return a handle with progress/cancel control.
 */
export function startMediaUpload(file: File, userId: string): UploadHandle {
  const storage = getFirebaseStorage();
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const path = `media/${userId}/${timestamp}_${random}/${file.name}`;
  const storageRef = ref(storage, path);

  const task: UploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
  });

  let settled = false;
  let latestProgress = 0;
  let lastActivityAt = Date.now();
  const listeners = new Set<(progress: number) => void>();
  
  // Calculate dynamic stall timeout based on file size
  const stallTimeoutMs = getStallTimeoutMs(file.size);

  const report = (p: number) => {
    latestProgress = p;
    for (const cb of listeners) cb(p);
  };

  const unsubscribe = task.on(
    "state_changed",
    (snapshot) => {
      lastActivityAt = Date.now();
      report((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
    },
    () => {},
    () => {}
  );

  // Stall timer - declared before promise to avoid temporal dead zone issues
  const stallTimer = setInterval(() => {
    if (settled) return;
    if (Date.now() - lastActivityAt > stallTimeoutMs) {
      console.warn(`Upload stalled for ${file.name} (${file.size} bytes) after ${stallTimeoutMs}ms - cancelling`);
      task.cancel(); // rejects the promise → surfaces as a failed upload
    }
  }, 5_000);

  const promise = new Promise<string>((resolve, reject) => {
    task.then(
      async () => {
        settled = true;
        clearInterval(stallTimer);
        unsubscribe();
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          report(100);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      },
      (error) => {
        settled = true;
        clearInterval(stallTimer);
        unsubscribe();
        reject(error);
      }
    );
  });

  return {
    promise,
    cancel: () => {
      if (!settled) task.cancel();
    },
    getProgress: () => latestProgress,
    onProgress: (cb) => {
      listeners.add(cb);
      cb(latestProgress);
      return () => {
        listeners.delete(cb);
      };
    },
    isSettled: () => settled,
  };
}

/**
 * Create a media draft from a (possibly compressed) file: instant local blob
 * URL for optimistic rendering + background upload already kicked off.
 */
export function createMediaDraft(
  file: File,
  mediaType: MediaDraftType,
  userId: string,
  mediaDuration: number | null
): MediaDraft {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    mediaType,
    mediaSize: file.size,
    mediaDuration,
    localUrl: URL.createObjectURL(file),
    handle: startMediaUpload(file, userId),
  };
}
