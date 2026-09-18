import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.UI_TEST_MODE === '1' ? process.env.UI_TEST_DIST_DIR || '.next-ui-test' : '.next',
  typescript: { tsconfigPath: process.env.UI_TEST_MODE === '1' ? process.env.UI_TEST_TSCONFIG || 'tsconfig.json' : 'tsconfig.json' },
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.steamstatic.com',
      },
    ],
  },
  turbopack: {},
};

export default nextConfig;
