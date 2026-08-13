import { NextResponse } from 'next/server';
import { receiveOrder } from '@/lib/localStore';

export const dynamic = 'force-dynamic';

// POST /api/orders/:orderId/receive  body: { quantity, date?, notes? } → { ok: true, order, item }
// Logs a delivery against an order, bumps S755 stock, and records the transaction. Never touches Smartsheet.
export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const quantity = Number(body.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be a positive number.' }, { status: 400 });
    }

    const result = receiveOrder({
      orderId: params.orderId,
      quantity,
      date: body.date,
      notes: body.notes,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
