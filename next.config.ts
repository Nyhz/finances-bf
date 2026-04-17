import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Caddy proxies https://finances.lan → localhost:3200, so HMR/dev-fetch
  // requests carry the LAN hostname as their Origin. Whitelist it.
  allowedDevOrigins: ["finances.lan"],
};

export default nextConfig;
