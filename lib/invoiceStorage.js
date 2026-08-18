// Storage for uploaded invoice/PO PDFs — Postgres-backed (see lib/db.js),
// same database as lib/localStore.js. Never uploaded anywhere else, never
// referenced by Smartsheet. SERVER-ONLY.
//
// Was node:fs-based (data/invoices/) — moved to Postgres because Vercel's
// serverless functions run on a read-only filesystem.

import { randomUUID } from 'node:crypto';
import { sql } from './db.js';

export async function saveInvoiceFile(buffer, originalFilename) {
  const fileId = randomUUID();
  await sql`
    INSERT INTO invoice_files (id, filename, content)
    VALUES (${fileId}, ${originalFilename || 'invoice.pdf'}, ${buffer})
  `;
  return { fileId };
}

export async function readInvoiceFile(fileId) {
  if (!/^[0-9a-f-]+$/i.test(fileId)) throw new Error('Invalid file id.');
  const rows = await sql`SELECT content FROM invoice_files WHERE id = ${fileId}`;
  if (!rows[0]) throw new Error('Invoice file not found.');
  return rows[0].content;
}
