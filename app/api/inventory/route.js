import { NextResponse } from 'next/server';
import { getInventory } from '@/lib/smartsheet';

export const dynamic = 'force-dynamic';

// GET /api/inventory  → { items: [...] }
export async function GET() {
  try {
    const { items } = await getInventory();
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
