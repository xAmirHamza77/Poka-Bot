/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.DESKTOP_BUILD === '1' ? {
    output: 'export', trailingSlash: true, images: { unoptimized: true },
  } : {}),
};
export default nextConfig;
