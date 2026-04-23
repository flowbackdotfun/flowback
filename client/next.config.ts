import type { NextConfig } from "next";

const relayUrl =
  process.env.RELAY_URL ??
  process.env.NEXT_PUBLIC_RELAY_URL ??
  "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/waitlist",
        destination: `${relayUrl}/waitlist`,
      },
    ];
  },
};

export default nextConfig;
