import { normalizeInviteEmail } from "@/lib/invite-utils";
import connectDB from "@/lib/mongodb";
import Invite from "@/models/invite";
import { NextRequest, NextResponse } from "next/server";
import { COMMUNITIES_ENABLED } from '@/lib/features';
import { getCurrentUser } from '@/lib/auth/current-user';
import { isSameOriginJSON } from '@/lib/security/request';

function response(body: { status: number; message: string }, status = body.status) {
    return NextResponse.json(body, { status });
}

export async function PUT(req: NextRequest) {
    if (!isSameOriginJSON(req)) return response({ status: 403, message: 'Use a same-origin JSON request' });
    const user = await getCurrentUser();
    if (!user) {
        return response({ status: 401, message: 'Unauthorized' });
    }

    try {
        const body = await req.json();
        const tokens = Array.isArray(body.tokens)
            ? body.tokens.filter((token: unknown): token is string => typeof token === 'string' && token.length > 0)
            : [];

        if (tokens.length === 0 || tokens.length > 50 || tokens.some((token: string) => !/^[a-f0-9]{40,64}$/i.test(token))) {
            return response({ status: 400, message: 'No invites selected' });
        }

        await connectDB();

        const email = normalizeInviteEmail(user.email);
        if (!email) {
            return response({ status: 401, message: 'Unauthorized' });
        }

        await Invite.updateMany(
            { token: { $in: tokens }, email, ...(!COMMUNITIES_ENABLED ? { inviteType: 'family' } : {}) },
            { read: Boolean(body.read), updatedAt: new Date() }
        );

        return response({ status: 200, message: 'Invites updated' });
    } catch (error) {
        console.error('[invite/edit] Failed', error);
        return response({ status: 500, message: 'Failed to update invites' });
    }
}
