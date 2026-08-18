// Runs once, before any route module is loaded, for every new server
// instance/container. This is the only point that reliably runs earlier
// than pdfjs-dist's own module-load-time `new DOMMatrix()` call
// (node_modules/pdfjs-dist/legacy/build/pdf.mjs, ~line 16713) — a bare
// top-level statement inside pdfjs-dist's own bundled file, not inside any
// function we can intercept. pdfjs-dist tries to self-polyfill DOMMatrix
// from `@napi-rs/canvas` a few lines earlier in that same file, but if that
// native module fails to load (as it does in some serverless environments
// depending on how the platform binary gets bundled), it never sets
// globalThis.DOMMatrix and the later `new DOMMatrix()` throws
// "DOMMatrix is not defined" — before any code in lib/pdfText.js ever gets
// a chance to run, no matter how early it tries. Setting it here, at server
// boot, guarantees it's already present by the time pdfjs-dist first loads.
export async function register() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    const { default: DOMMatrixPolyfill } = await import('dommatrix');
    globalThis.DOMMatrix = DOMMatrixPolyfill;
  }
}
