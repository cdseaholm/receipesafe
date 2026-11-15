import type { IRecipe } from '@/models/types/recipes/recipe';
import type { IUser } from '@/models/types/personal/user';

export type RecipeViewer = Pick<IUser, '_id' | 'email' | 'userFamilyID'>;

export function canUserViewRecipe(recipe: Pick<IRecipe, '_id' | 'secret' | 'creatorID' | 'secretViewerIDs'>, userId: string, _userEmail: string, familyRecipeIds: string[] = []) {
    if (!recipe.secret) return true;
    if (!userId) return false;
    return recipe.creatorID === userId || Boolean(recipe.secretViewerIDs?.includes(userId)) || familyRecipeIds.includes(String(recipe._id));
}

export function recipeVisibilityFilter(user: RecipeViewer | null, familyRecipeIds: string[] = []) {
    const clauses: Record<string, unknown>[] = [{ secret: { $ne: true } }];
    if (user) {
        clauses.push({ creatorID: String(user._id) }, { secretViewerIDs: { $in: [String(user._id)] } });
        if (familyRecipeIds.length) clauses.push({ _id: { $in: familyRecipeIds } });
    }
    return { $or: clauses };
}

export function recipeForViewer(recipe: IRecipe, user: RecipeViewer | null): IRecipe {
    return String(recipe.creatorID) === String(user?._id) ? recipe : { ...recipe, secretViewerIDs: [], originFamilyID: '' };
}
