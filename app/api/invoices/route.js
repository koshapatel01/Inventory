import { NextResponse } from 'next/server';
import { extractPdfText } from '@/lib/pdfText';
import { parseInvoiceText } from '@/lib/invoiceParser';
import { saveInvoiceFile } from '@/lib/invoiceStorage';
import { saveInvoiceRecord } from '@/lib/localStore';
import { getInventory } from '@/lib/smartsheet';

export const dynamic = 'force-dynamic';

// POST /api/invoices  multipart/form-data, field "file" (a PDF)
// → { ok: true, invoice, lines }. Parses the PDF, matches each line item to a
// catalog item by SKU, and stores the file + a metadata record locally.
// Never touches Smartsheet, and creates no orders — that's a separate,
// explicit step the user takes after reviewing these lines.
export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractPdfText(buffer);

    // Match against the real catalog's Item Numbers rather than guessing a
    // generic code pattern — real SKUs vary too much (letters/digits mixed,
    // or even plain phrases) for one regex to reliably catch them all.
    const { items: catalogItems } = await getInventory();
    const catalogBySkuUpper = new Map(
      catalogItems.filter((item) => item.sku).map((item) => [item.sku.toUpperCase(), item])
    );
    const parsed = parseInvoiceText(text, catalogItems.map((item) => item.sku).filter(Boolean));

    const lines = parsed.lineItems.map((line) => {
      const match = catalogBySkuUpper.get(line.sku.toUpperCase());
      if (!match) return { ...line, matched: false };
      return {
        ...line,
        sku: match.sku, // normalize to the catalog's canonical casing
        matched: true,
        rowId: match.rowId,
        itemName: match.name,
        minimum: match.minimum,
        catalogVendor: match.vendor,
        orderLink: match.orderLink || null,
      };
    });

    const { fileId } = saveInvoiceFile(buffer, file.name || 'invoice.pdf');
    const invoice = saveInvoiceRecord({
      fileId,
      originalFilename: file.name || 'invoice.pdf',
      vendor: parsed.vendor,
      referenceNumber: parsed.referenceNumber,
      orderDate: parsed.orderDate,
      invoiceDate: parsed.invoiceDate,
    });

    // Included so the review UI can show what was actually extracted when
    // matching comes up short — invoice layouts vary enough that seeing the
    // raw text is often the fastest way to tell what went wrong.
    const rawTextPreview = text.slice(0, 6000);

    return NextResponse.json({ ok: true, invoice, lines, rawTextPreview });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
