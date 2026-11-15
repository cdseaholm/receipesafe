import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { AccountClosureError, closeAccount } from '@/lib/account-lifecycle';
import { accountJSON } from '@/lib/auth/request-body';
import { isSameOriginJSON } from '@/lib/security/request';
import { consumeRateLimit } from '@/lib/security/rate-limit';

export async function DELETE(request: NextRequest) {
    if (!isSameOriginJSON(request)) return NextResponse.json({ status: 403, message: 'Invalid request origin' }, { status: 403 });
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ status: 401, message: 'Unauthorized' }, { status: 401 });
    if (!(await consumeRateLimit(`account:delete:${actor._id}`, { limit: 5, windowMs: 15 * 60_000 })).allowed) {
        return NextResponse.json({ status: 429, message: 'Please wait before trying again' }, { status: 429 });
    }
    let input;
    try { input = await accountJSON(request); }
    catch { return NextResponse.json({ status: 400, message: 'Invalid or oversized request' }, { status: 400 }); }
    try {
        const result = await closeAccount(actor, { password: input.password, confirmation: input.confirmation });
        return NextResponse.json({ status: 200, message: `Account closed. Recover through email recovery before ${result.purgeAfter}. Remaining owned recipes will be permanently deleted after that deadline.`, ...result });
    } catch (error) {
        const status = error instanceof AccountClosureError ? error.status : 500;
        return NextResponse.json({ status, message: error instanceof AccountClosureError ? error.message : 'Unable to close the account. No closure was committed. Please retry.' }, { status });
    }
}
