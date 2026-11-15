'use server';
import { revalidatePath } from 'next/cache';
import Recipe from '@/models/recipe';
import { Types } from 'mongoose';
import { getRevalidationPath } from './utils';
import { familyFailure, withFamilyMutation } from '@/lib/family-mutations';

export async function AddRecipeToFamily(recipeId: string, familyId: string, route: string) {
    if (typeof recipeId !== 'string' || !Types.ObjectId.isValid(recipeId)) return { success: false, message: 'Invalid recipe ID' };
    const result = await withFamilyMutation(familyId, async ({ user, family, member, session }) => {
        if (member.permissionStatus === 'Guest') return familyFailure('Family member privileges are required');
        const recipe = await Recipe.findById(recipeId).session(session);
        if (!recipe || (recipe.secret && recipe.creatorID !== String(user._id))) return familyFailure('Only the creator can share a private recipe');
        // Serialize sharing with privacy updates so a concurrent public-to-private change cannot be re-shared by a non-owner.
        await Recipe.updateOne({ _id: recipeId }, { $inc: { __v: 1 } }, { session });
        family.recipeIDs = Array.from(new Set([...(family.recipeIDs || []), recipeId]));
        await family.save({ session });
        return { success: true, message: 'Recipe added to family successfully', members: family.familyMembers };
    });
    if (result.success) { revalidatePath(getRevalidationPath(route)); revalidatePath('/u/recipes'); }
    return result;
}

export async function RemoveRecipesFromFamily(recipeIds: string[], familyId: string, route: string) {
    if (!Array.isArray(recipeIds) || !recipeIds.length || recipeIds.length > 100 || recipeIds.some(id => typeof id !== 'string' || !Types.ObjectId.isValid(id))) return { success: false, message: 'Select valid recipe IDs (at most 100)' };
    const result = await withFamilyMutation(familyId, async ({ family, member, session }) => {
        if (member.permissionStatus !== 'Admin') return familyFailure('Family admin privileges are required');
        family.recipeIDs = (family.recipeIDs || []).filter(id => !recipeIds.includes(id));
        await family.save({ session });
        return { success: true, message: 'Recipes removed from family successfully', members: family.familyMembers };
    });
    if (result.success) { revalidatePath(getRevalidationPath(route)); revalidatePath('/u/recipes'); }
    return result;
}
