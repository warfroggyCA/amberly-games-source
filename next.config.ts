import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  // Only the explicit local Gym launcher supplies LAN hosts; no wildcard trust.
  ...(process.env.AMBERLY_GYM_LAB_ENABLED === "true"
    ? {
        allowedDevOrigins: (process.env.GYM_PREVIEW_HOSTS ?? "")
          .split(",")
          .filter((host) => /^\d+\.\d+\.\d+\.\d+$/.test(host)),
      }
    : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
