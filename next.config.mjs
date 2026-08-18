/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist relies on dynamic worker loading that webpack mishandles when
  // bundled — keep it as a plain Node import for server routes instead.
  // @napi-rs/canvas ships a native binary (pdfjs-dist loads it internally to
  // measure glyphs for certain embedded font types) that webpack can't
  // bundle either.
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  },
};

export default nextConfig;
