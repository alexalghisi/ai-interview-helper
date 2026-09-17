/** Mic / screen capture only work in a secure context (HTTPS or localhost). */
export const INSECURE_MEDIA_MESSAGE =
  "Chrome blocks the microphone and screen capture on this HTTP address. On your laptop open http://localhost:47317 — keep the phone on the 192.168… link.";

export function isInsecureMediaContext(): boolean {
  return typeof window !== "undefined" && !window.isSecureContext;
}
