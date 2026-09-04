"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Mic, RefreshCw, Square, Video, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import {
  compressImage,
  formatDuration,
  formatFileSize,
  getExtensionForMimeType,
  getSupportedMimeType,
} from "@/lib/firebase-client";
import {
  createMediaDraft,
  startMediaUpload,
  type MediaDraft,
} from "@/lib/media-upload";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

type UploadStatus = "uploading" | "ready" | "failed";

type MediaPickerProps = {
  userId: string;
  /** The current media draft (owned by the chat hook; cleared on send). */
  draft: MediaDraft | null;
  onDraftChange: (draft: MediaDraft | null) => void;
};

/**
 * Request microphone permission on native platforms (Android/iOS).
 * Uses Capacitor's Permissions API if available, otherwise falls back to getUserMedia.
 * Returns true if granted, false if denied or unavailable.
 */
async function requestMicrophonePermission(): Promise<{ granted: boolean; denied: boolean }> {
  try {
    // Check if mediaDevices API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { granted: false, denied: false };
    }

    // On native platforms, try to use Capacitor Permissions API if available
    if (Capacitor.isNativePlatform()) {
      try {
        // Dynamically import @capacitor/permissions if available
        const { Permissions } = await import("@capacitor/permissions");
        const check = await Permissions.query({ name: "microphone" as any });
        
        if (check.state === "granted") {
          return { granted: true, denied: false };
        } else if (check.state === "denied") {
          return { granted: false, denied: true };
        }
        
        // Request permission
        const request = await Permissions.request({ name: "microphone" as any });
        return { granted: request.state === "granted", denied: request.state === "denied" };
      } catch {
        // @capacitor/permissions not installed, fall through to getUserMedia
      }
    }

    // Fallback: use getUserMedia to trigger permission dialog
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Immediately stop the stream - we just wanted to check permission
    stream.getTracks().forEach((track) => track.stop());
    return { granted: true, denied: false };
  } catch (err) {
    console.error("Microphone permission request failed:", err);
    // Check if error indicates permission denial
    if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
      return { granted: false, denied: true };
    }
    return { granted: false, denied: false };
  }
}

/**
 * Check if microphone permission is granted.
 * Returns true if granted, false if denied or unavailable.
 */
async function checkMicrophonePermission(): Promise<boolean> {
  const result = await requestMicrophonePermission();
  return result.granted;
}

/**
 * Composer media controls — Messenger-style, never blocking:
 *
 * - Picking a photo/video (or stopping a voice recording) creates a draft
 *   immediately: the upload starts in the background and a small chip above
 *   the input shows live progress. The user can keep typing and send right
 *   away; the chat hook awaits the upload when the message is sent.
 * - There is no modal and no "stuck sending" state: failed uploads offer a
 *   retry on the chip (before send) and on the bubble itself (after send).
 */
export function MediaPicker({ userId, draft, onDraftChange }: MediaPickerProps) {
  const [error, setError] = useState<string | null>(null);
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Voice recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const recordingTimeRef = useRef(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  // Upload status/progress are keyed by draft id, so switching or replacing a
  // draft implicitly resets them — no cascading setState in effects.
  const [statusInfo, setStatusInfo] = useState<{ draftId: string; status: UploadStatus } | null>(null);
  const [progressInfo, setProgressInfo] = useState<{ draftId: string; progress: number } | null>(null);

  const status = draft
    ? statusInfo?.draftId === draft.id ? statusInfo.status : "uploading"
    : null;
  const progress = draft
    ? progressInfo?.draftId === draft.id ? progressInfo.progress : 0
    : 0;

  // Subscribe to the active draft's upload promise + progress.
  useEffect(() => {
    if (!draft) return;
    const draftId = draft.id;
    let active = true;
    const unsubscribe = draft.handle.onProgress((p) => {
      setProgressInfo({ draftId, progress: p });
    });
    draft.handle.promise.then(
      () => {
        if (active) setStatusInfo({ draftId, status: "ready" });
      },
      () => {
        if (active) setStatusInfo({ draftId, status: "failed" });
      }
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [draft]);

  /** Discard the current draft: cancel its upload and free the blob URL. */
  const discardDraft = useCallback(() => {
    if (!draft) return;
    draft.handle.cancel();
    URL.revokeObjectURL(draft.localUrl);
    onDraftChange(null);
  }, [draft, onDraftChange]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "video") => {
      let file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      if (file.size > MAX_FILE_SIZE) {
        setError("File too large. Maximum size is 50MB.");
        return;
      }

      setError(null);
      
      // Validate file type
      if (type === "image" && !file.type.startsWith("image/")) {
        setError("Invalid file type. Please select an image file.");
        return;
      }
      if (type === "video" && !file.type.startsWith("video/")) {
        setError("Invalid file type. Please select a video file.");
        return;
      }

      // Compress images before upload (skip for videos)
      if (type === "image") {
        try {
          const originalSize = file.size;
          const compressedFile = await compressImage(file, 1200, 0.75);
          // Only use compressed file if it's actually smaller
          if (compressedFile.size < originalSize) {
            file = compressedFile;
            console.log("Image compressed: " + formatFileSize(originalSize) + " -> " + formatFileSize(file.size));
          }
        } catch (err) {
          console.warn("Image compression failed, using original:", err);
          // Continue with original file - compression is optional
        }
      }

      // Replacing an existing draft? Tear the old one down first.
      if (draft) discardDraft();

      // Draft creation starts the background upload immediately — the chip
      // below shows progress, and the message can be sent at any moment.
      onDraftChange(createMediaDraft(file, type, userId, null));
    },
    [userId, draft, discardDraft, onDraftChange]
  );

  const startRecording = useCallback(async () => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("Voice recording is not supported on this device.");
        return;
      }

      // Get supported MIME type first (before permission request)
      const mimeType = getSupportedMimeType();
      
      // Request microphone permission - this will trigger the permission dialog
      // On native platforms, this uses Capacitor's Permissions API if available
      const permission = await requestMicrophonePermission();
      
      if (!permission.granted) {
        setMicPermissionGranted(false);
        // Provide helpful instructions based on platform
        const isNative = Capacitor.isNativePlatform();
        if (permission.denied) {
          // Permission was explicitly denied
          const instructions = isNative
            ? "Microphone access denied. Please enable microphone permission in your device settings: Settings > Apps > Chismisa > Permissions > Microphone."
            : "Microphone access denied. Please allow microphone permission in your browser settings and refresh the page.";
          setError(instructions);
        } else {
          // Permission dialog was dismissed or not available
          setError("Microphone permission is required to record voice messages.");
        }
        return;
      }
      
      // Permission granted - get the audio stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionGranted(true);
      
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      discardRef.current = false;
      recordingTimeRef.current = 0;
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        const elapsed = recordingTimeRef.current;
        setRecording(false);
        setRecordingTime(0);

        // Recording cancelled — drop the chunks.
        if (discardRef.current) return;

        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        const ext = getExtensionForMimeType(mimeType || "audio/webm");
        const file = new File([blob], "voice_" + Date.now() + ext, { type: mimeType || "audio/webm" });
        setError(null);
        if (draft) discardDraft();
        // Duration comes from the recording timer (reliable for WebM blobs,
        // whose metadata duration is often Infinity/NaN).
        onDraftChange(createMediaDraft(file, "voice", userId, elapsed));
      };
      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime(recordingTimeRef.current);
      }, 1000);
      setError(null);
    } catch (err) {
      console.error("Voice recording error:", err);
      
      // Handle specific error types
      if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setMicPermissionGranted(false);
          // Provide helpful instructions based on platform
          const isNative = Capacitor.isNativePlatform();
          const instructions = isNative
            ? "Microphone access denied. Please enable microphone permission in your device settings: Settings > Apps > Chismisa > Permissions > Microphone."
            : "Microphone access denied. Please allow microphone permission in your browser settings and refresh the page.";
          setError(instructions);
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setError("No microphone found. Please connect a microphone and try again.");
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          setError("Microphone is in use by another app. Please close other apps and try again.");
        } else {
          setError("Could not start voice recording. Error: " + err.message);
        }
      } else {
        setError("Could not start voice recording. Please check your microphone.");
      }
    }
  }, [userId, draft, discardDraft, onDraftChange]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) mediaRecorderRef.current.stop();
  }, [recording]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      discardRef.current = true;
      mediaRecorderRef.current.stop();
    }
  }, [recording]);

  /** Chip-level retry: start a fresh upload for the same file. */
  const retryUpload = useCallback(() => {
    if (!draft || status !== "failed") return;
    const fresh = startMediaUpload(draft.file, userId);
    setStatusInfo({ draftId: draft.id, status: "uploading" });
    setProgressInfo({ draftId: draft.id, progress: 0 });
    // Immutable swap so the chat hook's send path picks up the new upload.
    onDraftChange({ ...draft, handle: fresh });
  }, [draft, status, userId, onDraftChange]);

  const recordingControlsDisabled = recording;

  return (
    <div className="relative flex items-center gap-1">
      <input ref={imageInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFileSelect(e, "image")} />
      <input ref={videoInputRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => handleFileSelect(e, "video")} />
      <button type="button" onClick={() => imageInputRef.current?.click()} disabled={recordingControlsDisabled} className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-gossip disabled:opacity-40" title="Send image"><Camera className="h-4 w-4" /></button>
      <button type="button" onClick={() => videoInputRef.current?.click()} disabled={recordingControlsDisabled} className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-gossip disabled:opacity-40" title="Send video"><Video className="h-4 w-4" /></button>
      <button type="button" onClick={() => { if (recording) stopRecording(); else startRecording(); }} disabled={!!draft} className={`rounded-lg p-2 transition-colors disabled:opacity-40 ${recording ? "bg-red-500 text-white" : "text-ink-muted hover:bg-surface-raised hover:text-gossip"}`} title={recording ? "Stop recording" : "Record voice message"}>
        {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      {recording && (
        <>
          <span className="animate-pulse text-xs font-medium text-red-500">{formatDuration(recordingTime)}</span>
          <button type="button" onClick={cancelRecording} className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink-text" title="Cancel recording"><X className="h-4 w-4" /></button>
        </>
      )}

      {/* Draft chip — live upload progress, never blocks the composer */}
      {draft && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-hairline bg-surface-raised p-2 shadow-xl">
          <div className="flex items-center gap-2">
            {draft.mediaType === "image" && (
              <img src={draft.localUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            )}
            {draft.mediaType === "video" && (
              <video src={draft.localUrl} muted playsInline className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            )}
            {draft.mediaType === "voice" && (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gossip-deep text-white"><Mic className="h-4 w-4" /></div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink-text">
                {draft.mediaType === "voice" ? `Voice message${draft.mediaDuration ? ` (${formatDuration(draft.mediaDuration)})` : ""}` : draft.file.name}
              </p>
              {status === "uploading" && (
                <div className="mt-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                    <div className="h-full rounded-full bg-gossip transition-all" style={{ width: `${Math.max(3, progress)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-muted">Uploading… {Math.round(progress)}%</p>
                </div>
              )}
              {status === "ready" && (
                <p className="mt-0.5 text-[10px] text-gossip">{formatFileSize(draft.mediaSize)} · Ready to send</p>
              )}
              {status === "failed" && (
                <p className="mt-0.5 text-[10px] text-red-400">Upload failed</p>
              )}
            </div>
            {status === "failed" ? (
              <button onClick={retryUpload} className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-gossip" title="Retry upload"><RefreshCw className="h-4 w-4" /></button>
            ) : null}
            <button onClick={discardDraft} className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink-text" title="Remove attachment"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {error && <div className="absolute bottom-full left-0 mb-2 rounded-lg bg-red-500 px-3 py-1 text-xs text-white shadow-lg">{error}</div>}
    </div>
  );
}
