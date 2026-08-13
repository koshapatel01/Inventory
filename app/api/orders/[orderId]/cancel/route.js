import { NextResponse } from 'next/server';
import { cancelOrder } from '@/lib/localStore';

export const dynamic = 'force-dynamic';

// POST /api/orders/:orderId/cancel  → { ok: true, order }
export async function POST(request, { params }) {
  try {
    const order = cancelOrder({ orderId: params.orderId });
    return NextResponse.json({ ok: true, order });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
