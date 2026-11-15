import mongoose from 'mongoose';
import Invite from '@/models/invite';
import Family from '@/models/family';
import MongoUser from '@/models/user';
import type { IFamilyMember } from '@/models/types/family/familyMember';
import type { IInvite } from '@/models/types/misc/invite';
import type { IUser } from '@/models/types/personal/user';
import { normalizeEmail } from './data-normalization';
import { connectedFamilyMember, FAMILY_ROLES } from './family-policy';
import connectDB from './mongodb';
import { isAccountActive, matchesSession } from '@/lib/auth/policy';

export const INVITE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
export const normalizeInviteEmail = normalizeEmail;
export function isInviteExpired(invite: Pick<IInvite, 'createdAt'>) {
    const created = new Date(invite.createdAt).getTime();
    return !Number.isFinite(created) || Date.now() - created > INVITE_EXPIRATION_MS;
}
export function serializeInvite(invite: IInvite): IInvite {
    return { email: invite.email, inviteType: invite.inviteType || 'family', familyID: invite.familyID,
        communityID: invite.communityID || '', token: invite.token, createdAt: invite.createdAt,
        invitedByUserID: invite.invitedByUserID, permissionStatus: invite.permissionStatus, read: Boolean(invite.read) };
}
export async function findValidInviteByToken(token: string) {
    if (typeof token !== 'string' || !/^[a-f0-9]{40,64}$/i.test(token)) return { invite: null, message: 'Invalid or expired invitation' };
    const invite = await Invite.findOne({ token }) as IInvite | null;
    if (!invite || isInviteExpired(invite)) return { invite: null, message: 'Invalid or expired invitation' };
    if ((invite.inviteType || 'family') === 'family' && !invite.invitedByUserID) return { invite: null, message: 'Ask your family admin to send a new invitation' };
    return { invite, message: 'Invitation found' };
}
export async function removePendingInviteMember(invite: IInvite) {
    if (!mongoose.isValidObjectId(invite.familyID)) return;
    await Family.updateOne({ _id: invite.familyID }, { $pull: { familyMembers: { familyMemberEmail: normalizeInviteEmail(invite.email), memberConnected: false } }, $inc: { __v: 1 } });
}

export async function acceptFamilyInviteForUser(invite: IInvite, actor: IUser) {
    const failure = (message: string, status = 403) => ({ success: false, status, message, members: [] as IFamilyMember[] });
    if (!isAccountActive(actor) || !actor.emailVerifiedAt || normalizeEmail(invite.email) !== normalizeEmail(actor.email)) return failure('Sign in with the verified invited email');
    await connectDB();
    const session = await mongoose.startSession();
    let result: { success: boolean; status: number; message: string; members: IFamilyMember[] } = failure('Invitation is unavailable');
    try {
        await session.withTransaction(async () => {
            const stored = await Invite.findOne({ token: invite.token }).session(session);
            const user = await MongoUser.findById(actor._id).select('+sessionVersion').session(session);
            if (!stored || (stored.inviteType || 'family') !== 'family' || isInviteExpired(stored)
                || !stored.invitedByUserID || !matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion ?? 0 }) || !user
                || normalizeEmail(stored.email) !== normalizeEmail(user.email)) { result = failure('Invalid or expired invitation'); return; }
            if (!mongoose.isValidObjectId(stored.familyID)) { result = failure('Invalid family'); return; }
            const family = await Family.findOne({ _id: stored.familyID, deletedAt: null }).session(session);
            if (!family) { result = failure('Family not found', 404); return; }
            const inviter = connectedFamilyMember(family, stored.invitedByUserID);
            const invitingUser = mongoose.isValidObjectId(stored.invitedByUserID)
                ? await MongoUser.findById(stored.invitedByUserID).session(session) : null;
            if (inviter?.permissionStatus !== 'Admin' || !isAccountActive(invitingUser) || !invitingUser?.emailVerifiedAt
                || String(invitingUser.userFamilyID) !== String(family._id)) { result = failure('The inviter is no longer a family admin. Request a new invitation.'); return; }
            if (user.userFamilyID && user.userFamilyID !== String(family._id)) { result = failure('Leave your current family before accepting this invitation', 409); return; }
            const existing = connectedFamilyMember(family, user._id);
            const permission = FAMILY_ROLES.includes(stored.permissionStatus!) ? stored.permissionStatus! : 'Member';
            // Existing members cannot use an old invitation to change their current role.
            const connected: IFamilyMember = { familyMemberID: String(user._id), familyMemberEmail: user.email,
                familyMemberName: user.name, permissionStatus: existing?.permissionStatus || permission, memberConnected: true };
            family.familyMembers = family.familyMembers.filter(item => item.familyMemberID !== String(user._id) && normalizeEmail(item.familyMemberEmail) !== normalizeEmail(user.email));
            family.familyMembers.push(connected);
            await family.save({ session });
            user.userFamilyID = String(family._id);
            await user.save({ session });
            await Invite.deleteOne({ token: stored.token }, { session });
            result = { success: true, status: 200, message: 'Invitation accepted', members: family.familyMembers };
        });
        return result;
    } catch (error) {
        console.error('Family invitation acceptance failed', error);
        return failure('Unable to accept invitation. Please retry.', 500);
    } finally { await session.endSession(); }
}
