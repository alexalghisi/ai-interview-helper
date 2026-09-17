import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gzip buffers long-lived SSE; phones would never see live answer tokens.
  compress: false,
  // Emit a self-contained server bundle for a small production container image.
  output: "standalone",
};

export default nextConfig;
