/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist relies on dynamic worker loading that webpack mishandles when
  // bundled — keep it as a plain Node import for server routes instead.
  // @napi-rs/canvas ships a native binary (pdfjs-dist loads it internally to
  // measure glyphs for certain embedded font types) that webpack can't
  // bundle either.
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
    // Runs instrumentation.js's register() at server boot, before any route
    // module loads — required for the DOMMatrix polyfill to install early
    // enough (Next 15+ enables this by default; still opt-in on 14.x).
    instrumentationHook: true,
  },
};

export default nextConfig;
