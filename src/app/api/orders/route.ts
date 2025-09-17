import { NextResponse } from 'next/server';
import { getOrder, createOrder, updateOrder } from '@/lib/db';

/**
 * GET /api/orders
 * If `code` is provided as a query parameter, returns a single order.
 * Otherwise, this endpoint currently returns an empty array since listing
 * orders is not part of the initial requirements. Extend as needed.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) {
    return NextResponse.json({ orders: [] });
  }
  const order = getOrder(code);
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  return NextResponse.json({ order });
}

/**
 * POST /api/orders
 * Create a new order. Expects a JSON body with `code`, `data`, `floor`,
 * `section`, and optional `aliases` array. Returns the newly created order.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code, data, floor, section, aliases } = body;
    if (!code || !floor || !section) {
      return NextResponse.json(
        { error: 'Missing required fields: code, floor, section' },
        { status: 400 },
      );
    }
    const order = createOrder(code, data ?? {}, floor, section, aliases);
    return NextResponse.json({ order }, { status: 201 });
  } catch (err: any) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return NextResponse.json({ error: 'Order already exists' }, { status: 409 });
    }
    console.error('Error creating order', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/orders
 * Update an existing order. Expects a JSON body with `code` and optional
 * `collected`, `data`, `floor`, `section`. Returns the updated record.
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { code, collected, data, floor, section } = body;
    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }
    const updated = updateOrder(code, { collected, data, floor, section });
    if (!updated) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    return NextResponse.json({ order: updated });
  } catch (err: any) {
    console.error('Error updating order', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}