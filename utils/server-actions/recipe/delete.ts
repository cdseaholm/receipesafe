'use server'
import { revalidatePath } from 'next/cache';
import { deleteRecipesForUser } from '@/lib/recipe-mutations';
import { getAuthenticatedUser, getRevalidationPath } from './utils';
export async function DeleteRecipes(recipeIds: string[], route: string) {
    const { user, message } = await getAuthenticatedUser();
    if (!user) return { success: false, message };
    try {
        await deleteRecipesForUser(user, recipeIds);
        revalidatePath(getRevalidationPath(route));
        return { success: true, message: 'Recipes deleted successfully' };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Failed to delete recipes' };
    }
}
