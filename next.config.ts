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
        ],
      },
    ];
  },
};

export default nextConfig;
