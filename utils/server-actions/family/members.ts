'use server';

import { revalidatePath } from 'next/cache';
import Invite from '@/models/invite';
import User from '@/models/user';
import { familyMemberKey, hasConnectedAdmin } from '@/lib/family-policy';
import { familyFailure, withFamilyMutation } from '@/lib/family-mutations';
import { getRevalidationPath, verifyUserPassword } from './utils';

export async function RemoveFamilyMembers(familyId: string, memberIds: string[], adminPassword: string, route: string) {
    if (!Array.isArray(memberIds) || !memberIds.length || memberIds.length > 100 || memberIds.some(id => typeof id !== 'string')) return familyFailure('Select valid family members');
    const result = await withFamilyMutation(familyId, async ({ user, family, member, session }) => {
        if (member.permissionStatus !== 'Admin') return familyFailure('Admin privileges are required');
        if (!(await verifyUserPassword(user, adminPassword))) return familyFailure('Password is incorrect. Google users can set a password from account recovery first.');
        const keys = new Set(memberIds.map(id => id.trim().toLowerCase()));
        const existing = new Set(family.familyMembers.map(familyMemberKey));
        if ([...keys].some(key => !existing.has(key))) return familyFailure('One or more members do not belong to this family');
        const removed = family.familyMembers.filter(item => keys.has(familyMemberKey(item)));
        const remaining = family.familyMembers.filter(item => !keys.has(familyMemberKey(item)));
        if (!hasConnectedAdmin(remaining)) return familyFailure('At least one connected admin is required');
        family.familyMembers = remaining;
        await family.save({ session });
        const ids = removed.filter(item => item.memberConnected).map(item => item.familyMemberID).filter(Boolean);
        if (ids.length) await User.updateMany({ _id: { $in: ids }, userFamilyID: familyId }, { $set: { userFamilyID: '' } }, { session });
        await Invite.deleteMany({ familyID: familyId, inviteType: 'family', email: { $in: removed.map(item => item.familyMemberEmail.toLowerCase()) } }, { session });
        return { success: true, message: 'Members removed successfully', members: remaining };
    });
    if (result.success) revalidatePath(getRevalidationPath(route, `/family/${familyId}/members`));
    return result;
}

export async function LeaveFamily(familyId: string, route = '/') {
    const result = await withFamilyMutation(familyId, async ({ user, family, session }) => {
        const remaining = family.familyMembers.filter(item => String(item.familyMemberID) !== String(user._id));
        if (!hasConnectedAdmin(remaining)) return familyFailure('Assign another connected admin before leaving, or delete the family if you are its last member');
        family.familyMembers = remaining;
        await family.save({ session });
        await User.updateOne({ _id: user._id, userFamilyID: familyId }, { $set: { userFamilyID: '' } }, { session });
        return { success: true, message: 'Successfully left family', members: remaining };
    });
    if (result.success) revalidatePath(getRevalidationPath(route));
    return result;
}
