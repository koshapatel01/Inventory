import { NextResponse } from 'next/server';
import { cancelOrder } from '@/lib/localStore';
import { logEvent } from '@/lib/smartsheetLog';

export const dynamic = 'force-dynamic';

// POST /api/orders/:orderId/cancel  → { ok: true, order }
// Never touches the Smartsheet catalog. Best-effort mirrored to the separate
// Smartsheet audit-log sheet (see lib/smartsheetLog.js) after the local write —
// awaited (not fire-and-forget) because Vercel can freeze a serverless
// function the instant its response is sent, which can kill an in-flight,
// un-awaited request before it completes. logEvent() never throws, so
// awaiting it adds a little latency but can't block or fail this operation.
export async function POST(request, { params }) {
  try {
    const order = await cancelOrder({ orderId: params.orderId });

    await logEvent({
      timestamp: new Date().toISOString(),
      eventType: 'Order Cancelled',
      item: order.itemName,
      itemNumber: order.itemNumber,
      quantity: order.quantityOrdered,
      unitPrice: order.unitPrice,
      extendedTotal: order.estimatedTotal,
      vendor: order.vendor,
      person: order.orderedBy,
      orderId: order.id,
    });

    return NextResponse.json({ ok: true, order });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
