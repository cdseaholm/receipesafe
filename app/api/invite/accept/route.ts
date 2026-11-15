import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { acceptFamilyInviteForUser, findValidInviteByToken } from '@/lib/invite-utils';
import { isSameOriginJSON } from '@/lib/security/request';

export async function POST(request: NextRequest) {
    const response = (status: number, message: string, returnedMembers: unknown[] = []) => NextResponse.json({ status, message, returnedMembers }, { status });
    if (!isSameOriginJSON(request)) return response(403, 'Use a same-origin JSON request');
    const user = await getCurrentUser();
    if (!user) return response(401, 'Sign in with the verified invited email');
    try {
        const body = await request.json();
        const { invite, message } = await findValidInviteByToken(body.token || body.invite?.token);
        if (!invite) return response(404, message);
        const accepted = await acceptFamilyInviteForUser(invite, user);
        return response(accepted.status, accepted.message, accepted.members);
    } catch { return response(500, 'Unable to accept invitation'); }
}
