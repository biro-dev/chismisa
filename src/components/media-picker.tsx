"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, Mic, Video, X } from "lucide-react";
import { uploadMedia, formatDuration, formatFileSize, compressImage, getSupportedMimeType, getExtensionForMimeType } from "@/lib/firebase-client";

export type MediaAttachment = {
  mediaUrl: string;
  mediaType: "image" | "video" | "voice";
  mediaThumb?: string | null;
  mediaSize?: number | null;
  mediaDuration?: number | null;
};

type MediaPickerProps = {
  userId: string;
  onPendingMediaChange: (media: MediaAttachment | null) => void;
};

export function MediaPicker({ userId, onPendingMediaChange }: MediaPickerProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [preview, setPreview] = useState<{
    type: "image" | "video" | "voice";
    url: string;
    name: string;
    size: number;
    duration?: number;
  } | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "video") => {
      let file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      if (file.size > 50 * 1024 * 1024) {
        setError("File too large. Maximum size is 50MB.");
        return;
      }

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      // Compress images before upload (skip for videos)
      if (type === "image") {
        try {
          const originalSize = file.size;
          file = await compressImage(file, 1200, 0.75);
          console.log("Image compressed: " + formatFileSize(originalSize) + " -> " + formatFileSize(file.size));
        } catch (err) {
          console.warn("Image compression failed, using original:", err);
        }
      }

      const previewUrl = URL.createObjectURL(file);
      setPreview({ type, url: previewUrl, name: file.name, size: file.size });
      try {
        const result = await uploadMedia(file, userId, (p) => setUploadProgress(p));
        onPendingMediaChange({ mediaUrl: result.url, mediaType: type, mediaSize: file.size, mediaDuration: null, mediaThumb: null });
      } catch (err) {
        console.error("Upload failed:", err);
        setError("Upload failed. Please try again.");
        setPreview(null);
      } finally {
        setUploading(false);
      }
    },
    [userId, onPendingMediaChange]
  );
  const startRecording = useCallback(async () => {
    try {
      const mimeType = getSupportedMimeType();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        const ext = getExtensionForMimeType(mimeType || "audio/webm");
        const file = new File([blob], "voice_" + Date.now() + ext, { type: mimeType || "audio/webm" });
        setRecording(false);
        setRecordingTime(0);
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        setUploading(true);
        setUploadProgress(0);
        try {
          const result = await uploadMedia(file, userId, (p) => setUploadProgress(p));
          const audio = new Audio(URL.createObjectURL(blob));
          const duration = await new Promise<number>((resolve) => { audio.onloadedmetadata = () => resolve(audio.duration); audio.onerror = () => resolve(0); });
          const media = { mediaUrl: result.url, mediaType: "voice" as const, mediaSize: file.size, mediaDuration: Math.round(duration), mediaThumb: null };
          onPendingMediaChange(media);
          setPreview({ type: "voice", url: result.url, name: "Voice message", size: file.size, duration: Math.round(duration) });
        } catch (err) {
          console.error("Voice upload failed:", err);
          setError("Upload failed. Please try again.");
        } finally {
          setUploading(false);
        }
      };
      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
      setError(null);
    } catch (err) {
      console.error("Voice recording error:", err);
      const msg = err instanceof Error && err.name === "NotAllowedError"
        ? "Microphone access denied. Please allow microphone permission in your device settings."
        : "Could not start voice recording. Please check your microphone.";
      setError(msg);
    }
  }, [userId, onPendingMediaChange]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) mediaRecorderRef.current.stop();
  }, [recording]);

  const clearPreview = useCallback(() => {
    setPreview(null);
    setCaption("");
    onPendingMediaChange(null);
  }, [onPendingMediaChange]);
  return (
    <div className="flex items-center gap-1">
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileSelect(e, "image")} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFileSelect(e, "video")} />
      <button type="button" onClick={() => imageInputRef.current?.click()} disabled={uploading || recording || !!preview} className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-gossip disabled:opacity-40" title="Send image"><Camera className="h-4 w-4" /></button>
      <button type="button" onClick={() => videoInputRef.current?.click()} disabled={uploading || recording || !!preview} className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-raised hover:text-gossip disabled:opacity-40" title="Send video"><Video className="h-4 w-4" /></button>
      <button type="button" onClick={() => { if (recording) stopRecording(); else startRecording(); }} disabled={uploading || !!preview} className={`rounded-lg p-2 transition-colors disabled:opacity-40 ${recording ? "bg-red-500 text-white animate-pulse" : "text-ink-muted hover:bg-surface-raised hover:text-gossip"}`} title={recording ? "Stop recording" : "Record voice message"}><Mic className="h-4 w-4" />{recording && <span className="ml-1 text-xs">{recordingTime}s</span>}</button>
      {preview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={clearPreview}>
          <div className="relative max-w-lg rounded-2xl bg-surface-raised p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={clearPreview} className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"><X className="h-4 w-4" /></button>
            {preview.type === "image" && <img src={preview.url} alt="Preview" className="max-h-80 max-w-full rounded-xl" />}
            {preview.type === "video" && <video src={preview.url} controls className="max-h-80 max-w-full rounded-xl" />}
            {preview.type === "voice" && (
              <div className="flex flex-col items-center gap-2 p-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gossip-deep text-white"><Mic className="h-8 w-8" /></div>
                <p className="text-sm text-ink-text">Voice message</p>
                <audio src={preview.url} controls className="w-full" />
              </div>
            )}
            {uploading && (
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-gossip transition-all" style={{ width: `${uploadProgress}%` }} /></div>
                <p className="mt-1 text-center text-xs text-ink-muted">Uploading... {Math.round(uploadProgress)}%</p>
              </div>
            )}
            {!uploading && (
              <div className="mt-3">
                <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption..." className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink-text outline-none focus:border-gossip" />
                <p className="mt-1 text-right text-[10px] text-ink-muted">{formatFileSize(preview.size)}{preview.duration ? ` ${formatDuration(preview.duration)}` : ""}</p>
              </div>
            )}
          </div>
        </div>
      )}
      {error && <div className="absolute bottom-full left-0 mb-2 rounded-lg bg-red-500 px-3 py-1 text-xs text-white shadow-lg">{error}</div>}
    </div>
  );
}





