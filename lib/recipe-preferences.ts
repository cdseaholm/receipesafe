import 'server-only';
import mongoose from 'mongoose';
import User from '@/models/user';
import Recipe from '@/models/recipe';
import type { IUser } from '@/models/types/personal/user';
import type { IRecipe } from '@/models/types/recipes/recipe';
import { isAccountActiveFilter, matchesSession } from '@/lib/auth/policy';
import { canUserViewRecipeForUser } from '@/lib/data/recipes';

/** Keep the actor's bookmark and the recipe counter atomic with account closure and purge. */
export async function toggleRecipePreference(actor: IUser, recipeId: string, selected: boolean, kind: 'saved' | 'favorite') {
    const field = kind === 'saved' ? 'savedRecipeIDs' : 'favoriteRecipeIDs';
    const counter = kind === 'saved' ? 'saveCount' : 'favoriteCount';
    const session = await mongoose.startSession();
    try {
        return await session.withTransaction(async () => {
            const user = await User.findById(actor._id).select('+sessionVersion').session(session);
            if (!matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion })) throw new Error('Your session changed. Sign in again');
            const recipe = await Recipe.findById(recipeId).session(session).lean<IRecipe>();
            if (!recipe || (selected && !await canUserViewRecipeForUser(recipe, user))) throw new Error('Recipe not found');
            const alreadySelected = (user![field] || []).includes(recipeId);
            if (selected === alreadySelected) return { changed: false, count: recipe[counter] || 0 };
            const version = user!.sessionVersion ?? 0;
            const changed = await User.updateOne({ _id: actor._id, [field]: selected ? { $ne: recipeId } : recipeId,
                $and: [isAccountActiveFilter(), { $or: [{ sessionVersion: version }, ...(version === 0 ? [{ sessionVersion: { $exists: false } }] : [])] }] },
                selected ? { $addToSet: { [field]: recipeId } } : { $pull: { [field]: recipeId } }, { session });
            if (!changed.modifiedCount) throw new Error('Your session or collection changed. Please retry');
            // The transaction retries if another actor changes this recipe counter after our read.
            const count = Math.max(0, (recipe[counter] || 0) + (selected ? 1 : -1));
            const updated = await Recipe.findByIdAndUpdate(recipeId, { $set: { [counter]: count, updatedAt: new Date() } }, { new: true, session }).lean<IRecipe>();
            if (!updated) throw new Error('Recipe not found');
            return { changed: true, count: updated[counter] || 0 };
        });
    } finally { await session.endSession(); }
}
