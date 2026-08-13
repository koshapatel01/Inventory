/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist relies on dynamic worker loading that webpack mishandles when
  // bundled — keep it as a plain Node import for server routes instead.
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
};

export default nextConfig;
