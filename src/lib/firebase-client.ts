"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getStorage } from "firebase/storage";

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

/**
 * Compress an image file before upload.
 * Resizes to maxDimension (longest side) and converts to JPEG at the given quality.
 * Returns the original file if it's not an image or if compression fails.
 */
export function compressImage(
  file: File,
  maxDimension = 1200,
  quality = 0.75
): Promise<File> {
  // Only compress images, not videos or other types
  if (!file.type.startsWith("image/")) {
    return Promise.resolve(file);
  }

  // Don't bother compressing small images
  if (file.size < 200 * 1024) {
    return Promise.resolve(file);
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Only resize if larger than maxDimension
      if (width <= maxDimension && height <= maxDimension) {
        resolve(file);
        return;
      }

      // Calculate new dimensions (maintain aspect ratio)
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file); // fallback to original
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file); // fallback to original
            return;
          }
          const compressedFile = new File([blob], file.name, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fallback to original on error
    };

    img.src = objectUrl;
  });
}

/**
 * Determine the best supported audio MIME type for MediaRecorder.
 */
export function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;

  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/mpeg",
    "audio/wav",
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return null; // Let the browser choose
}

/**
 * Get the file extension for the given MIME type.
 */
export function getExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return ".m4a";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("wav")) return ".wav";
  return ".webm"; // default
}
