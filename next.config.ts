import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevent clickjacking — the app is never meant to be framed.
          { key: "X-Frame-Options", value: "DENY" },
          // Stop browsers from MIME-sniffing responses.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak full URLs (which contain ?group=<id>) to other sites.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable unused browser features (camera/mic/etc. are not used).
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Content Security Policy — restricts what the page can load and
          // connect to. Allowlist covers everything the app actually uses:
          // - scripts/styles: bundled from 'self' (+ inline styles/attrs used
          //   by Next's bootstrap and our animation delays)
          // - realtime: Pusher over WSS (and HTTPS fallback for sockjs)
          // - push: FCM registration endpoints on *.googleapis.com and
          //   *.firebaseio.com (web push; native uses the FCM SDK directly)
          // - workers: same-origin service workers (PWA + firebase-messaging)
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' wss://*.pusher.com https://*.pusher.com https://*.googleapis.com https://*.firebaseio.com",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
