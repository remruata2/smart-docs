import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Configure compiler options
  compiler: {
    // Enable styled-components support
    styledComponents: true,
  },
  // Server external packages
  serverExternalPackages: [
    "mammoth",
    "xlsx",
    "@xenova/transformers",
    "llamaindex",
  ],
  // Experimental features
  experimental: {
    serverActions: {
      // Increase body size limit to 50MB for file uploads
      bodySizeLimit: "50mb",
    },
    // Increase timeout for server components
  },
  // Allow cross-origin requests from demo.lushaimedia.in
  allowedDevOrigins: ["demo.lushaimedia.in"],
  // Add timeout configurations
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "X-Response-Time",
            value: "300000", // 5 minutes
          },
        ],
      },
    ];
  },
  // Increase server timeout
  serverRuntimeConfig: {
    // Increase timeout for API routes
    maxDuration: 300, // 5 minutes
  },
  // Performance optimizations
  poweredByHeader: false,
  compress: true,
  // Increase memory limit for large queries
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;
