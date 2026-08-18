import { NextResponse } from 'next/server';
import { transferStock } from '@/lib/localStore';
import { logEvent } from '@/lib/smartsheetLog';
import { STAFF, TRANSFER_DESTINATIONS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// POST /api/transfers  body: { rowId, itemName, quantity, destination, person } → { ok: true, updated }
// Moves stock from S755 to the destination breakroom in the local store and logs
// it. Never touches the Smartsheet catalog. Best-effort mirrored to the separate
// Smartsheet audit-log sheet (see lib/smartsheetLog.js) after the local write —
// awaited (not fire-and-forget) because Vercel can freeze a serverless
// function the instant its response is sent, which can kill an in-flight,
// un-awaited request before it completes. logEvent() never throws, so
// awaiting it adds a little latency but can't block or fail this operation.
export async function POST(request) {
  try {
    const body = await request.json();
    const { rowId, itemName, destination, person } = body;
    const quantity = Number(body.quantity);

    if (!rowId || !itemName) {
      return NextResponse.json({ error: 'Missing item.' }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be a positive number.' }, { status: 400 });
    }
    if (!TRANSFER_DESTINATIONS.includes(destination)) {
      return NextResponse.json({ error: 'Invalid destination.' }, { status: 400 });
    }
    if (!STAFF.includes(person)) {
      return NextResponse.json({ error: 'Invalid person.' }, { status: 400 });
    }

    const updated = await transferStock({ rowId, itemName, quantity, destination, person });

    await logEvent({
      timestamp: new Date().toISOString(),
      eventType: 'Transfer',
      item: itemName,
      quantity,
      source: 'S755',
      destination,
      person,
    });

    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
