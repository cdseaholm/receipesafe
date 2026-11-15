import Ingredient from "@/models/ingredient";
import Recipe from "@/models/recipe";
import { IIngredient } from "@/models/types/recipes/ingredient";
import { IRecipe } from "@/models/types/recipes/recipe";
import { serializeDoc } from "@/utils/data/seralize";
import { ObjectId } from "mongodb";
import { cache } from "react";
import Family from '@/models/family';
import { getFamilyMember, hasConnectedMembership } from '@/utils/server-actions/family/utils';
import { canUserViewRecipe, recipeForViewer, recipeVisibilityFilter, type RecipeViewer } from '@/lib/recipe-access';
import type { IUser } from '@/models/types/personal/user';
import User from '@/models/user';
import { isAccountActive } from '@/lib/auth/policy';

async function inactiveRecipeCreators(creatorIds: string[]) {
    const ids = Array.from(new Set(creatorIds)).filter(id => ObjectId.isValid(id));
    if (!ids.length) return new Set<string>();
    const creators = await User.find({ _id: { $in: ids } }).select('accountStatus').lean();
    return new Set(creators.filter(creator => !isAccountActive(creator)).map(creator => String(creator._id)));
}

export const getFamilySharedRecipeIds = cache(async (user: RecipeViewer | null): Promise<string[]> => {
    if (!user?.userFamilyID || !ObjectId.isValid(user.userFamilyID)) return [];
    const family = await Family.findOne({ _id: user.userFamilyID, deletedAt: null }).lean();
    if (!family || !hasConnectedMembership(getFamilyMember(family, user as IUser), user as IUser)) return [];
    return (family.recipeIDs || []).filter((id: string) => ObjectId.isValid(id));
});

export const getRecipesVisibleToUser = cache(async (ids: string[], user: RecipeViewer | null): Promise<IRecipe[]> => {
    if (!ids.length) return [];
    const objectIds = Array.from(new Set(ids))
        .filter(id => ObjectId.isValid(id))
        .map(id => new ObjectId(id));

    if (!objectIds.length) return [];

    const familyRecipeIds = await getFamilySharedRecipeIds(user);
    const docs = await Recipe.find({ $and: [{ _id: { $in: objectIds } }, recipeVisibilityFilter(user, familyRecipeIds)] }).lean();
    const inactiveCreators = await inactiveRecipeCreators(docs.map(doc => doc.creatorID));
    return docs.filter(doc => !inactiveCreators.has(String(doc.creatorID)))
        .map(doc => recipeForViewer(serializeDoc<IRecipe>(doc), user));
})

export const getRecipesByIds = getRecipesVisibleToUser;

export async function getRecipeVisibleToUser(id: string, user: RecipeViewer | null) {
    return (await getRecipesVisibleToUser([id], user))[0] || null;
}

export async function canUserViewRecipeForUser(recipe: IRecipe, user: RecipeViewer | null) {
    if ((await inactiveRecipeCreators([recipe.creatorID])).has(String(recipe.creatorID))) return false;
    return canUserViewRecipe(recipe, user ? String(user._id) : '', user?.email || '', await getFamilySharedRecipeIds(user));
}

export const getAllIngredients = cache(async (): Promise<IIngredient[]> => {
    const docs = await Ingredient.find({}).lean();
    return docs.map(doc => serializeDoc<IIngredient>(doc));
})
