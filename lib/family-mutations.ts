import mongoose, { type ClientSession, type HydratedDocument } from 'mongoose';
import connectDB from '@/lib/mongodb';
import { getCurrentUser } from '@/lib/auth/current-user';
import User from '@/models/user';
import Family from '@/models/family';
import type { IUser } from '@/models/types/personal/user';
import type { IFamily } from '@/models/types/family/family';
import type { IFamilyMember } from '@/models/types/family/familyMember';
import { connectedFamilyMember } from '@/lib/family-policy';
import { matchesSession } from '@/lib/auth/policy';

export type FamilyMutationResult = { success: boolean; message: string; members: IFamilyMember[]; family?: IFamily | null };
type Context = { user: HydratedDocument<IUser>; family: HydratedDocument<IFamily>; member: IFamilyMember; session: ClientSession };
export function familyFailure(message: string): FamilyMutationResult { return { success: false, message, members: [] }; }

/** Membership and roles are rechecked inside the same transaction as the writes. */
export async function withFamilyMutation(familyId: string, mutate: (context: Context) => Promise<FamilyMutationResult>) {
    const actor = await getCurrentUser();
    if (!actor) return familyFailure('Sign in with a verified account');
    if (!mongoose.isValidObjectId(familyId)) return familyFailure('Invalid family');
    await connectDB();
    const session = await mongoose.startSession();
    let result = familyFailure('Unable to update family');
    try {
        await session.withTransaction(async () => {
            const user = await User.findById(actor._id).select('+sessionVersion').session(session);
            const family = await Family.findOne({ _id: familyId, deletedAt: null }).session(session);
            if (!matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion ?? 0 })
                || !user || !family || String(user.userFamilyID) !== String(family._id)) {
                result = familyFailure('You do not belong to this family'); return;
            }
            const member = connectedFamilyMember(family, user._id);
            if (!member) { result = familyFailure('You do not belong to this family'); return; }
            result = await mutate({ user, family, member, session });
        });
        return result;
    } catch (error) {
        console.error('Family transaction failed', error);
        return familyFailure('The family could not be updated. Please retry.');
    } finally { await session.endSession(); }
}
