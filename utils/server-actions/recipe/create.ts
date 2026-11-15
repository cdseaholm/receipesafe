'use server';
import { revalidatePath } from 'next/cache';
import type { IRecipe } from '@/models/types/recipes/recipe';
import { createRecipeForUser } from '@/lib/recipe-mutations';
import { validatedRecipeInput } from '@/lib/recipe-input';
import { getAuthenticatedUser, getRevalidationPath } from './utils';
import { familyFailure, withFamilyMutation } from '@/lib/family-mutations';

export async function CreateRecipe(values: IRecipe, route: string, familyId?: string) {
    const { user, message } = await getAuthenticatedUser();
    if (!user) return { success: false, message, recipeId: null };
    try {
        validatedRecipeInput(values);
        let recipeId: string | null = null;
        if (familyId) {
            const result = await withFamilyMutation(familyId, async ({ user: memberUser, family, member, session }) => {
                if (member.permissionStatus === 'Guest') return familyFailure('Family member privileges are required');
                const recipe = await createRecipeForUser(memberUser, values, familyId, session);
                recipeId = String(recipe._id);
                family.recipeIDs = Array.from(new Set([...(family.recipeIDs || []), recipeId]));
                await family.save({ session });
                return { success: true, message: 'Recipe created for family', members: family.familyMembers };
            });
            if (!result.success) return { success: false, message: result.message, recipeId: null };
        } else {
            recipeId = String((await createRecipeForUser(user, values))._id);
        }
        revalidatePath(getRevalidationPath(route));
        if (familyId) revalidatePath(`/family/${familyId}/recipes`);
        return { success: true, message: 'Recipe created successfully', recipeId };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Failed to create recipe', recipeId: null };
    }
}
