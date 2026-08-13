import { NextResponse } from 'next/server';
import { transferStock } from '@/lib/localStore';
import { STAFF, TRANSFER_DESTINATIONS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// POST /api/transfers  body: { rowId, itemName, quantity, destination, person } → { ok: true, updated }
// Moves stock from S755 to the destination breakroom in the local store and logs it. Never touches Smartsheet.
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

    const updated = transferStock({ rowId, itemName, quantity, destination, person });
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
