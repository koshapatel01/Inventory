import { NextResponse } from 'next/server';
import { getOrders, placeOrder } from '@/lib/localStore';
import { STAFF } from '@/lib/config';

export const dynamic = 'force-dynamic';

// GET /api/orders?rowId=  → { orders }
export async function GET(request) {
  const rowId = request.nextUrl.searchParams.get('rowId');
  const orders = getOrders(rowId ? { rowId } : {});
  return NextResponse.json({ orders });
}

// POST /api/orders  body: { rowId, itemName, itemNumber, quantity, orderedBy, vendor, link?, unitPrice, notes? }
// Creates an order-history record. Never touches Smartsheet or item stock — stock only changes on receipt.
export async function POST(request) {
  try {
    const body = await request.json();
    const { rowId, itemName, itemNumber, orderedBy, vendor, link, notes } = body;
    const quantity = Number(body.quantity);
    const unitPrice = Number(body.unitPrice);

    if (!rowId || !itemName) {
      return NextResponse.json({ error: 'Missing item.' }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be a positive number.' }, { status: 400 });
    }
    if (!STAFF.includes(orderedBy)) {
      return NextResponse.json({ error: 'Invalid orderedBy.' }, { status: 400 });
    }
    if (!vendor || !String(vendor).trim()) {
      return NextResponse.json({ error: 'Vendor is required.' }, { status: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: 'Unit price must be a non-negative number.' }, { status: 400 });
    }

    const order = placeOrder({
      rowId, itemName, itemNumber, quantity, orderedBy,
      vendor: String(vendor).trim(), link, unitPrice, notes,
    });
    return NextResponse.json({ ok: true, order });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
