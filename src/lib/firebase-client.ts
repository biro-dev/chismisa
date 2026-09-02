"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  type StorageReference,
  type UploadTask,
} from "firebase/storage";

// Firebase client configuration — same project as push notifications
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: "chismisa-fd9b8.firebaseapp.com",
  projectId: "chismisa-fd9b8",
  storageBucket: "chismisa-fd9b8.firebasestorage.app",
  messagingSenderId: "125114823607",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:125114823607:web:f912492a40e761b01aae32",
};

let firebaseApp: FirebaseApp | undefined;

function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) return firebaseApp;
  const existing = getApps()[0];
  if (existing) {
    firebaseApp = existing;
    return existing;
  }
  firebaseApp = initializeApp(firebaseConfig);
  return firebaseApp;
}

export function getFirebaseStorage() {
  return getStorage(getFirebaseApp());
}

/**
 * Upload a media file to Firebase Storage.
 * Path: media/{userId}/{timestamp}_{random}/{filename}
 * Returns the download URL.
 */
export async function uploadMedia(
  file: File,
  userId: string,
  onProgress?: (progress: number) => void
): Promise<{ url: string; path: string }> {
  const storage = getFirebaseStorage();
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const path = `media/${userId}/${timestamp}_${random}/${file.name}`;
  const storageRef: StorageReference = ref(storage, path);

  return new Promise((resolve, reject) => {
    const task: UploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
    });

    task.on(
      "state_changed",
      (snapshot) => {
        if (onProgress) {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress(progress);
        }
      },
      (error) => reject(error),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve({ url, path });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/**
 * Format a duration in seconds to mm:ss for voice/video labels.
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format file size in bytes to a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
