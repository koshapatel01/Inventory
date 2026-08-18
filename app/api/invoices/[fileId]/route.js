import { NextResponse } from 'next/server';
import { readInvoiceFile } from '@/lib/invoiceStorage';

export const dynamic = 'force-dynamic';

// GET /api/invoices/:fileId — streams the stored invoice/PO PDF back.
export async function GET(request, { params }) {
  try {
    const bytes = await readInvoiceFile(params.fileId);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
