import { NextResponse } from 'next/server';
import { cancelOrder } from '@/lib/localStore';
import { logEvent } from '@/lib/smartsheetLog';

export const dynamic = 'force-dynamic';

// POST /api/orders/:orderId/cancel  → { ok: true, order }
// Never touches the Smartsheet catalog. Best-effort mirrored to the separate
// Smartsheet audit-log sheet (see lib/smartsheetLog.js) after the local write.
export async function POST(request, { params }) {
  try {
    const order = await cancelOrder({ orderId: params.orderId });

    logEvent({
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
