import { NextResponse } from 'next/server';
import { clearHistory, listHistory } from '@/lib/db';

export async function GET() {
  const history = listHistory();
  return NextResponse.json({ history });
}

export async function DELETE() {
  const cleared = clearHistory();
  return NextResponse.json({ cleared });
}
