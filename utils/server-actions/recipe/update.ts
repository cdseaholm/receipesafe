'use server'
import { revalidatePath } from 'next/cache';
import type { IRecipe } from '@/models/types/recipes/recipe';
import { updateRecipeForUser } from '@/lib/recipe-mutations';
import { getAuthenticatedUser, getRevalidationPath } from './utils';
export async function UpdateRecipe(recipeId: string, recipeData: IRecipe, route: string) {
    const { user, message } = await getAuthenticatedUser();
    if (!user) return { success: false, message };
    try {
        await updateRecipeForUser(user, recipeId, recipeData);
        revalidatePath(getRevalidationPath(route));
        return { success: true, message: 'Recipe updated successfully' };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Failed to update recipe' };
    }
}
