'use server';

import { revalidatePath } from 'next/cache';
import { canAttemptFavoriteToggle, getAuthenticatedUser, getRevalidationPath, isValidId } from './utils';
import { toggleRecipePreference } from '@/lib/recipe-preferences';

export async function ToggleFavoriteRecipe(recipeId: string, shouldFavorite: boolean, route: string) {
    if (typeof shouldFavorite !== 'boolean') return { success: false, message: 'Invalid favorite state', favorited: false, favoriteCount: 0 };
    if (!recipeId) return { success: false, message: 'Recipe ID is required', favorited: false, favoriteCount: 0 };
    if (!isValidId(recipeId)) return { success: false, message: 'Invalid recipe ID', favorited: false, favoriteCount: 0 };
    if (!route) return { success: false, message: 'Route is required for revalidation', favorited: false, favoriteCount: 0 };
    try {
        const { user, message } = await getAuthenticatedUser();
        if (!user) return { success: false, message, favorited: false, favoriteCount: 0 };
        if (!(await canAttemptFavoriteToggle(String(user._id)))) return {
            success: false, message: 'Please wait a moment before updating favorites again',
            favorited: user.favoriteRecipeIDs?.includes(recipeId) || false, favoriteCount: 0,
        };
        const result = await toggleRecipePreference(user, recipeId, shouldFavorite, 'favorite');
        if (result.changed) revalidatePath(getRevalidationPath(route));
        return { success: true, message: result.changed
            ? shouldFavorite ? 'Recipe added to favorites' : 'Recipe removed from favorites'
            : shouldFavorite ? 'Recipe already favorited' : 'Recipe already removed from favorites',
        favorited: shouldFavorite, favoriteCount: result.count };
    } catch (error) {
        console.error(error);
        return { success: false, message: 'Failed to update favorites', favorited: false, favoriteCount: 0 };
    }
}
