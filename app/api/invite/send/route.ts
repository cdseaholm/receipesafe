import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import Invite from '@/models/invite';
import User from '@/models/user';
import InviteTemplate from '@/emails/invite-template-email';
import { getCurrentUser } from '@/lib/auth/current-user';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { isSameOriginJSON } from '@/lib/security/request';
import { withFamilyMutation, familyFailure } from '@/lib/family-mutations';
import { FAMILY_ROLES } from '@/lib/family-policy';
import { normalizeInviteEmail } from '@/lib/invite-utils';
import type { IFamilyMember } from '@/models/types/family/familyMember';

const response = (status: number, message: string, members: IFamilyMember[] = []) => NextResponse.json({ status, message, famMembersReturned: members }, { status });
export async function POST(request: NextRequest) {
    if (!isSameOriginJSON(request)) return response(403, 'Use a same-origin JSON request');
    const actor = await getCurrentUser();
    if (!actor) return response(401, 'Sign in with a verified account');
    if (!(await consumeRateLimit(`family-invite:${actor._id}`, { limit: 10, windowMs: 3600_000 })).allowed) return response(429, 'Please wait before sending more invitations');
    try {
        const body = await request.json();
        const requested = body.emails?.newMembers;
        if (!Array.isArray(requested) || !requested.length || requested.length > 10) return response(400, 'Invite 1–10 people at a time');
        const normalized = requested.map(item => ({ email: normalizeInviteEmail(typeof item?.email === 'string' ? item.email : ''), permission: item?.permissions }));
        if (normalized.some(item => !/^\S+@\S+\.\S+$/.test(item.email) || item.email.length > 254 || !FAMILY_ROLES.includes(item.permission))) return response(400, 'Each invite needs a valid email and family role');
        const from = process.env.EMAIL_FROM;
        const key = process.env.RESEND_API_KEY;
        const base = process.env.NEXT_PUBLIC_INVITE_BASE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL;
        if (!from || !key || !base || (process.env.NODE_ENV === 'production' && new URL(base).protocol !== 'https:')) return response(503, 'Invitation email is not configured');
        const queued: { email: string; token: string }[] = [];
        let familyName = '';
        const mutation = await withFamilyMutation(String(body.familyId), async ({ family, member, session }) => {
            if (member.permissionStatus !== 'Admin') return familyFailure('Admin privileges are required');
            familyName = family.name;
            // Transactions may retry; send email only after commit.
            queued.length = 0;
            for (const item of normalized) {
                if (queued.some(entry => entry.email === item.email) || family.familyMembers.some(entry => entry.memberConnected && normalizeInviteEmail(entry.familyMemberEmail) === item.email)) continue;
                const existing = await User.findOne({ email: item.email }).session(session);
                if (existing?.userFamilyID && existing.userFamilyID !== String(family._id)) continue;
                await Invite.deleteMany({ familyID: String(family._id), inviteType: 'family', email: item.email }, { session });
                const token = randomBytes(32).toString('hex');
                await Invite.create([{ email: item.email, familyID: String(family._id), inviteType: 'family', token,
                    permissionStatus: item.permission, invitedByUserID: String(actor._id) }], { session });
                family.familyMembers = family.familyMembers.filter(entry => entry.memberConnected || normalizeInviteEmail(entry.familyMemberEmail) !== item.email);
                family.familyMembers.push({ familyMemberID: existing ? String(existing._id) : '', familyMemberEmail: item.email, familyMemberName: '', permissionStatus: item.permission, memberConnected: false });
                queued.push({ email: item.email, token });
            }
            if (!queued.length) return familyFailure('These people are already members or belong to another family');
            await family.save({ session });
            return { success: true, message: 'Invitations prepared', members: family.familyMembers };
        });
        if (!mutation.success) return response(403, mutation.message);
        const resend = new Resend(key);
        let failures = 0;
        for (const item of queued) {
            try {
                const sent = await resend.emails.send({ from: `RecipeSafe <${from}>`, to: item.email,
                    subject: `Family invitation from ${actor.name}`, react: InviteTemplate({ senderName: actor.name, familyName,
                        inviteLink: `${base.replace(/\/$/, '')}/invite?token=${item.token}`, firstName: item.email.split('@')[0] }) });
                if (sent.error || !sent.data) failures++;
            } catch { failures++; }
        }
        // Committed invitations remain usable in the verified recipient's inbox even if mail fails.
        return response(200, failures ? 'Invitations are in the recipients’ inboxes, but some emails could not be delivered. You can resend them.' : 'Invitations sent', mutation.members);
    } catch (error) { console.error('Family invitations failed', error); return response(500, 'Unable to send invitations'); }
}
