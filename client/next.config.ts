import type { NextConfig } from "next";

const relayUrl =
  process.env.RELAY_URL ??
  process.env.NEXT_PUBLIC_RELAY_URL ??
  "http://localhost:3001";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/flowback/quote",
        destination: `${relayUrl}/quote`,
      },
      {
        source: "/api/flowback/prepare",
        destination: `${relayUrl}/prepare`,
      },
      {
        source: "/api/flowback/intent",
        destination: `${relayUrl}/intent`,
      },
      {
        source: "/api/waitlist",
        destination: `${relayUrl}/waitlist`,
      },
      {
        source: "/api/flowback/mev-analysis/:wallet",
        destination: `${relayUrl}/mev-analysis/:wallet`,
      },
    ];
  },
};

export default nextConfig;
