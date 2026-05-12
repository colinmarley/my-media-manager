/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_IGNORE_LINT === 'true',
  },
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_TYPE_ERRORS === 'true',
  },
  async rewrites() {
    return [
      // Note: do not add a rewrite for /api/backend/* as this is handled
      // by the Next.js API route at src/app/api/backend/[...path]/route.ts
      // which correctly forwards all HTTP methods including POST.
    ];
  },
};

export default nextConfig;
