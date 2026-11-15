import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ObjectId } from 'mongodb';
import User from '@/models/user';
import RecipeDetail from './components/recipe-detail';
import { createPageMetadata } from '@/lib/metadata';
import { getSessionUser } from '@/lib/data/user';
import { getRecipeVisibleToUser } from '@/lib/data/recipes';

type Params = { params: Promise<{ recipeid: string }> };
const readRecipe = cache(async (id: string) => {
    const currentUser = await getSessionUser();
    const recipe = await getRecipeVisibleToUser(id, currentUser);
    return { currentUser, recipe };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
    const { recipeid } = await params;
    const { recipe } = await readRecipe(recipeid);
    // Unauthorized private records also get generic metadata.
    return createPageMetadata({
        title: recipe?.name || 'Recipe',
        description: recipe?.description || 'View a preserved recipe.',
        robots: recipe?.secret || !recipe ? { index: false, follow: false } : undefined,
    });
}

export default async function Page({ params }: Params) {
    const { recipeid } = await params;
    const { currentUser, recipe } = await readRecipe(recipeid);
    if (!recipe) notFound();
    const creator = recipe.creatorID && ObjectId.isValid(recipe.creatorID)
        ? await User.findById(recipe.creatorID).select('name').lean() : null;
    return <RecipeDetail recipe={recipe} currentUser={currentUser} creatorName={creator?.name || 'Account Deleted'} />;
}
