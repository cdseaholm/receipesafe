'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import Family from '@/models/family';
import Invite from '@/models/invite';
import User from '@/models/user';
import Recipe from '@/models/recipe';
import { getCurrentUser } from '@/lib/auth/current-user';
import { familyFailure, withFamilyMutation } from '@/lib/family-mutations';
import { getRevalidationPath, verifyUserPassword } from './utils';
import { canDeleteFamily, connectedFamilyMember } from '@/lib/family-policy';
import connectDB from '@/lib/mongodb';
import { isAccountActiveFilter, matchesSession } from '@/lib/auth/policy';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export async function DeleteFamily(familyId: string, route = '/', adminPassword = '', confirmationName = '') {
    const result = await withFamilyMutation(familyId, async ({ user, family, session }) => {
        if (!canDeleteFamily(family, user._id)) return familyFailure('Admin privileges are required');
        if (typeof confirmationName !== 'string' || confirmationName.trim() !== family.name) return familyFailure('Type the family name to confirm');
        if (!(await verifyUserPassword(user, adminPassword))) return familyFailure('Password is incorrect. Google users can set a password from account recovery first.');
        const linked = await Recipe.find({ $or: [{ _id: { $in: family.recipeIDs } }, { originFamilyID: familyId }] }).session(session);
        family.familyOriginRecipeIDs = linked.filter(recipe => recipe.originFamilyID === familyId).map(recipe => String(recipe._id));
        family.familyRecipeShareVersions = linked.map(recipe => ({ recipeID: String(recipe._id), version: recipe.familySharingVersion || 0 }));
        // Canonical ownership survives removal of the family, including older missing personal links.
        for (const recipe of linked) {
            if (mongoose.isValidObjectId(recipe.creatorID)) await User.updateOne({ _id: recipe.creatorID }, { $addToSet: { recipeIDs: String(recipe._id) } }, { session });
        }
        await Recipe.updateMany({ originFamilyID: familyId }, { $set: { collectionOrigin: 'personal', originFamilyID: '' } }, { session });
        await User.updateMany({ userFamilyID: familyId }, { $set: { userFamilyID: '' } }, { session });
        await Invite.deleteMany({ familyID: familyId, inviteType: 'family' }, { session });
        family.deletedAt = new Date();
        family.restoreUntil = new Date(Date.now() + RETENTION_MS);
        family.deletedByUserID = String(user._id);
        await family.save({ session });
        return { success: true, message: 'Family archived for 30 days. Recipes remain in their creators’ personal collections.', members: [] };
    });
    if (result.success) { revalidatePath(getRevalidationPath(route)); revalidatePath('/u/profile'); revalidatePath('/u/recipes'); revalidatePath('/family'); }
    return result;
}

export async function RestoreFamily(familyId: string, adminPassword: string, confirmationName: string) {
    const actor = await getCurrentUser();
    if (!actor || !mongoose.isValidObjectId(familyId)) return familyFailure('Unauthorized');
    if (!(await verifyUserPassword(actor, adminPassword))) return familyFailure('Password is incorrect');
    await connectDB();
    const session = await mongoose.startSession();
    let result = familyFailure('Family archive is unavailable');
    try {
        await session.withTransaction(async () => {
            const family = await Family.findOne({ _id: familyId, deletedAt: { $ne: null }, restoreUntil: { $gt: new Date() } }).session(session);
            if (!family || connectedFamilyMember(family, actor._id)?.permissionStatus !== 'Admin') { result = familyFailure('Only a former connected admin can recover this family within 30 days'); return; }
            if (confirmationName?.trim() !== family.name) { result = familyFailure('Type the family name to confirm'); return; }
            const user = await User.findById(actor._id).select('+sessionVersion').session(session);
            if (!matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion ?? 0 })
                || !user || user.userFamilyID) { result = familyFailure('Sign in with an active account and leave your current family before recovering this one'); return; }
            const previousMembers = family.familyMembers.filter(member => member.memberConnected && mongoose.isValidObjectId(member.familyMemberID));
            const available = await User.find({ $and: [
                { _id: { $in: previousMembers.map(member => member.familyMemberID) }, userFamilyID: '', emailVerifiedAt: { $ne: null } },
                isAccountActiveFilter(),
            ] }).session(session);
            const availableById = new Map(available.map(member => [String(member._id), member]));
            family.familyMembers = previousMembers.filter(member => availableById.has(member.familyMemberID)).map(member => {
                const restored = availableById.get(member.familyMemberID)!;
                return { familyMemberID: String(restored._id), permissionStatus: member.permissionStatus,
                    memberConnected: true, familyMemberName: restored.name, familyMemberEmail: restored.email };
            });
            const restoredIds = family.familyMembers.map(member => member.familyMemberID);
            const recipes = await Recipe.find({ _id: { $in: family.recipeIDs }, $or: [{ secret: { $ne: true } }, { creatorID: { $in: restoredIds } }] }).session(session);
            const versions = new Map((family.familyRecipeShareVersions || []).map(entry => [entry.recipeID, entry.version]));
            const restorable = recipes.filter(recipe => !recipe.secret || versions.get(String(recipe._id)) === (recipe.familySharingVersion || 0));
            family.recipeIDs = restorable.map(recipe => String(recipe._id));
            for (const recipe of restorable) {
                if ((family.familyOriginRecipeIDs || []).includes(String(recipe._id)) && restoredIds.includes(recipe.creatorID)) {
                    recipe.collectionOrigin = 'family'; recipe.originFamilyID = familyId; await recipe.save({ session });
                }
            }
            await User.updateMany({ $and: [{ _id: { $in: restoredIds }, userFamilyID: '' }, isAccountActiveFilter()] }, { $set: { userFamilyID: familyId } }, { session });
            family.deletedAt = null; family.restoreUntil = undefined; family.deletedByUserID = ''; family.familyOriginRecipeIDs = []; family.familyRecipeShareVersions = [];
            await family.save({ session });
            result = { success: true, message: 'Family recovered. People who joined another family were not moved.', members: family.familyMembers };
        });
    } catch (error) { console.error('Family recovery failed', error); result = familyFailure('Unable to recover family. Please retry.'); }
    finally { await session.endSession(); }
    if (result.success) { revalidatePath('/family'); revalidatePath('/u/profile'); revalidatePath('/u/recipes'); }
    return result;
}
