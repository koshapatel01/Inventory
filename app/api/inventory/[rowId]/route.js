import { NextResponse } from 'next/server';
import { updateLocalItem } from '@/lib/localStore';
import { EDITABLE_FIELDS } from '@/lib/config';

export const dynamic = 'force-dynamic';

// PATCH /api/inventory/:rowId  body: { qtyS755?, qtyS821?, qtyTls?, status? }  → { ok: true }
// Writes to the local store only — Smartsheet is never modified.
export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const patch = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) {
        patch[field] = field.startsWith('qty') ? Number(body[field]) : body[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided.' }, { status: 400 });
    }
    await updateLocalItem(params.rowId, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
