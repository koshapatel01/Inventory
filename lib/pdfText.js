// Extracts flattened text from a PDF buffer using pdfjs-dist — the actively
// maintained pdf.js — instead of the abandoned `pdf-parse` package. That
// package bundles pdf.js snapshots from 2016-2018, and their xref-recovery
// only rebuilds the file's object table when the *whole* xref structure
// fails to parse; a single object with a slightly-off byte offset (common
// output from some vendor invoice-generation tools) instead throws an
// uncaught "bad XRef entry" and aborts. Current pdf.js is tested against a
// large corpus of malformed real-world PDFs and recovers from both cases.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const standardFontDataUrl = pathToFileURL(
  path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/') + '/'
).href;

// Mirrors the line-join behavior lib/invoiceParser.js is written to expect:
// a new line only on a vertical-position change, so text runs that share a
// row (different table cells) can still end up glued together with no
// separator — see the header comment in lib/invoiceParser.js.
export async function extractPdfText(buffer) {
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
