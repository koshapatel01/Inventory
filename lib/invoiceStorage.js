// Local-only storage for uploaded invoice/PO PDFs. SERVER-ONLY (uses node:fs).
// Files live under data/invoices/, alongside data/store.json — never uploaded
// anywhere, never referenced by Smartsheet.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const INVOICES_DIR = path.join(process.cwd(), 'data', 'invoices');

export function saveInvoiceFile(buffer, originalFilename) {
  if (!existsSync(INVOICES_DIR)) mkdirSync(INVOICES_DIR, { recursive: true });
  const fileId = randomUUID();
  const ext = path.extname(originalFilename || '') || '.pdf';
  const filePath = path.join(INVOICES_DIR, `${fileId}${ext}`);
  writeFileSync(filePath, buffer);
  return { fileId, filePath, ext };
}

export function getInvoiceFilePath(fileId) {
  if (!/^[0-9a-f-]+$/i.test(fileId)) throw new Error('Invalid file id.');
  const pdfPath = path.join(INVOICES_DIR, `${fileId}.pdf`);
  if (!existsSync(pdfPath)) throw new Error('Invoice file not found.');
  return pdfPath;
}

export function readInvoiceFile(fileId) {
  return readFileSync(getInvoiceFilePath(fileId));
}
