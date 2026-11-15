'use server';

import { revalidatePath } from 'next/cache';
import { FAMILY_ROLES, familyMemberKey, hasConnectedAdmin } from '@/lib/family-policy';
import { familyFailure, withFamilyMutation } from '@/lib/family-mutations';
import { getRevalidationPath, sanitizeFamilyMember, verifyUserPassword } from './utils';
import type { IFamilyMember } from '@/models/types/family/familyMember';
import Invite from '@/models/invite';

export async function UpdateFamilyName(familyId: string, newName: string, adminPassword: string, route: string) {
    if (typeof newName !== 'string' || !newName.trim() || newName.trim().length > 100) return familyFailure('Family name must be 1–100 characters');
    const result = await withFamilyMutation(familyId, async ({ user, family, member, session }) => {
        if (member.permissionStatus !== 'Admin') return familyFailure('Admin privileges are required');
        if (!(await verifyUserPassword(user, adminPassword))) return familyFailure('Password is incorrect. Google users can set a password from account recovery first.');
        family.name = newName.trim();
        await family.save({ session });
        return { success: true, message: 'Family name updated successfully', members: family.familyMembers, family: JSON.parse(JSON.stringify(family)) };
    });
    if (result.success) revalidatePath(getRevalidationPath(route, `/family/${familyId}/settings`));
    return result;
}

export async function UpdateFamilyMemberStatuses(familyId: string, changes: IFamilyMember[], adminPassword: string, route: string) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 100 || changes.some(item => !item || !FAMILY_ROLES.includes(item.permissionStatus))) return familyFailure('Select valid member roles');
    const result = await withFamilyMutation(familyId, async ({ user, family, member, session }) => {
        if (member.permissionStatus !== 'Admin') return familyFailure('Admin privileges are required');
        if (!(await verifyUserPassword(user, adminPassword))) return familyFailure('Password is incorrect. Google users can set a password from account recovery first.');
        const current = family.familyMembers.map(sanitizeFamilyMember);
        const updates = new Map(changes.map(item => [familyMemberKey(item), item.permissionStatus]));
        if (changes.some(item => !familyMemberKey(item) || !current.some(existing => familyMemberKey(existing) === familyMemberKey(item)))) return familyFailure('One or more members do not belong to this family');
        const updated = current.map(item => ({ ...item, permissionStatus: updates.get(familyMemberKey(item)) || item.permissionStatus }));
        if (!hasConnectedAdmin(updated)) return familyFailure('At least one connected admin is required');
        family.familyMembers = updated;
        await family.save({ session });
        for (const pending of updated.filter(item => !item.memberConnected)) {
            await Invite.updateMany({ familyID: familyId, inviteType: 'family', email: pending.familyMemberEmail },
                { $set: { permissionStatus: pending.permissionStatus } }, { session });
        }
        return { success: true, message: 'Member statuses updated successfully', members: updated };
    });
    if (result.success) revalidatePath(getRevalidationPath(route, `/family/${familyId}/settings`));
    return result;
}
