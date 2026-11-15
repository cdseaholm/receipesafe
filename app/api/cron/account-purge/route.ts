import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { purgeDueAccounts } from '@/lib/account-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const authorization = request.headers.get('authorization') || '';
    const expected = `Bearer ${secret || ''}`;
    if (!secret || secret.length < 32 || Buffer.byteLength(authorization) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    try {
        const result = await purgeDueAccounts();
        return NextResponse.json(result, { status: result.failed ? 503 : 200, headers: { 'Cache-Control': 'private, no-store' } });
    } catch {
        return NextResponse.json({ message: 'Account cleanup failed; retry required' }, { status: 503 });
    }
}
