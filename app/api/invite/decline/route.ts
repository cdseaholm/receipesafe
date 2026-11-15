import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { normalizeInviteEmail, removePendingInviteMember } from '@/lib/invite-utils';
import Invite from '@/models/invite';
import { isSameOriginJSON } from '@/lib/security/request';

export async function POST(request: NextRequest) {
    const response = (status: number, message: string) => NextResponse.json({ status, message }, { status });
    if (!isSameOriginJSON(request)) return response(403, 'Use a same-origin JSON request');
    const user = await getCurrentUser();
    if (!user) return response(401, 'Sign in with the verified invited email');
    try {
        const { token } = await request.json();
        if (typeof token !== 'string') return response(400, 'Invitation token is required');
        const invite = await Invite.findOne({ token, inviteType: 'family', email: normalizeInviteEmail(user.email) });
        if (!invite) return response(404, 'Invitation not found');
        await removePendingInviteMember(invite);
        await Invite.deleteOne({ _id: invite._id });
        return response(200, 'Invitation declined');
    } catch { return response(500, 'Unable to decline invitation'); }
}
