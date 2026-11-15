'use server';

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser, getRevalidationPath, isValidId } from './utils';
import { toggleRecipePreference } from '@/lib/recipe-preferences';

export async function ToggleSaveRecipe(recipeId: string, shouldSave: boolean, route: string) {
    if (typeof shouldSave !== 'boolean') return { success: false, message: 'Invalid save state', saved: false, saveCount: 0 };
    if (!recipeId) return { success: false, message: 'Recipe ID is required', saved: false, saveCount: 0 };
    if (!isValidId(recipeId)) return { success: false, message: 'Invalid recipe ID', saved: false, saveCount: 0 };
    if (!route) return { success: false, message: 'Route is required for revalidation', saved: false, saveCount: 0 };
    try {
        const { user, message } = await getAuthenticatedUser();
        if (!user) return { success: false, message, saved: false, saveCount: 0 };
        const result = await toggleRecipePreference(user, recipeId, shouldSave, 'saved');
        if (result.changed) revalidatePath(getRevalidationPath(route));
        return { success: true, message: result.changed
            ? shouldSave ? 'Recipe saved' : 'Recipe removed from saved recipes'
            : shouldSave ? 'Recipe already saved' : 'Recipe already removed from saved recipes',
        saved: shouldSave, saveCount: result.count };
    } catch (error) {
        console.error(error);
        return { success: false, message: 'Failed to update saved recipes', saved: false, saveCount: 0 };
    }
}
