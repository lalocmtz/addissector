import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite compilar en un directorio alterno (ej. CI/sandbox): NEXT_DIST_DIR=.next-build
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
