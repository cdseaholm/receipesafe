import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Recipe from '@/models/recipe';
import { getSessionUser } from '@/lib/data/user';
import { getRecipesVisibleToUser } from '@/lib/data/recipes';
import { createPageMetadata } from '@/lib/metadata';
import RecipePage from '../components/recipe-page';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export async function generateMetadata(): Promise<Metadata> {
    return createPageMetadata({ title: 'My Recipes', description: 'Manage your created, favorite and saved recipes.', robots: { index: false, follow: false } });
}
export default async function Page() {
    const user = await getSessionUser();
    if (!user) redirect('/login');
    const owned = await Recipe.find({ creatorID: user._id }).select('_id').lean();
    const allMixedRecipes = await getRecipesVisibleToUser([
        ...owned.map(doc => String(doc._id)), ...(user.savedRecipeIDs || []), ...(user.favoriteRecipeIDs || []),
    ], user);
    const visibleIds = new Set(allMixedRecipes.map(recipe => recipe._id));
    const safeUser = { ...user, recipeIDs: owned.map(doc => String(doc._id)),
        favoriteRecipeIDs: user.favoriteRecipeIDs.filter(id => visibleIds.has(id)), savedRecipeIDs: user.savedRecipeIDs.filter(id => visibleIds.has(id)) };
    return <RecipePage allMixedRecipes={allMixedRecipes} userInfo={safeUser} ingredients={[]} />;
}
