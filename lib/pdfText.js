// Extracts flattened text from a PDF buffer using pdfjs-dist — the actively
// maintained pdf.js — instead of the abandoned `pdf-parse` package. That
// package bundles pdf.js snapshots from 2016-2018, and their xref-recovery
// only rebuilds the file's object table when the *whole* xref structure
// fails to parse; a single object with a slightly-off byte offset (common
// output from some vendor invoice-generation tools) instead throws an
// uncaught "bad XRef entry" and aborts. Current pdf.js is tested against a
// large corpus of malformed real-world PDFs and recovers from both cases.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import DOMMatrixPolyfill from 'dommatrix';
// Side-effect-only import so Vercel's build-time file tracer sees a plain,
// statically-analyzable reference to this package and includes its native
// platform binary in the deployed function bundle. pdfjs-dist also requires
// it internally, but via a dynamically-constructed `createRequire(...)`
// call, which trace tools can miss — this import doesn't rely on that.
import '@napi-rs/canvas';

// Belt-and-suspenders fallback: pdfjs-dist tries to self-polyfill DOMMatrix
// from @napi-rs/canvas's own DOMMatrix at ITS module load time (see
// node_modules/pdfjs-dist/legacy/build/pdf.mjs, the `if (isNodeJS) {...}`
// block), then a few hundred lines later has a bare top-level
// `const SCALE_MATRIX = new DOMMatrix();` statement. Both run during
// pdfjs-dist's own module evaluation, entirely before control ever returns
// here — so this assignment can't reach that specific call in time no
// matter where it's placed in this file. The real fix is
// instrumentation.js's register(), which runs at server boot before
// pdfjs-dist is loaded by anyone. This assignment stays as a harmless
// fallback for any other pdfjs-dist code path that reads
// globalThis.DOMMatrix lazily, at actual request-processing time.
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = DOMMatrixPolyfill;
}

let pdfjsPromise;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

const standardFontDataUrl = pathToFileURL(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/') + '/'
).href;

// Mirrors the line-join behavior lib/invoiceParser.js is written to expect:
// a new line only on a vertical-position change, so text runs that share a
// row (different table cells) can still end up glued together with no
// separator — see the header comment in lib/invoiceParser.js.
export async function extractPdfText(buffer) {
  const { getDocument } = await loadPdfjs();
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    standardFontDataUrl,
  });
  const doc = await loadingTask.promise;
  try {
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let lastY;
      for (const item of content.items) {
        if (lastY === item.transform[5] || lastY === undefined) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      text += '\n\n';
    }
    return text;
  } finally {
    await loadingTask.destroy();
  }
}
