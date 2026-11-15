import mongoose, { Types, type ClientSession } from 'mongoose';
import Recipe from '@/models/recipe';
import Ingredient from '@/models/ingredient';
import User from '@/models/user';
import Family from '@/models/family';
import Community from '@/models/community';
import Post from '@/models/post';
import { validatedRecipeInput } from '@/lib/recipe-input';
import { claimRecipeImage, deleteOwnedUploads, releaseRecipeImage } from '@/lib/upload-ownership';
import { getUploadThingKeyFromUrl } from '@/utils/uploadthing/file-key';
import type { IUser } from '@/models/types/personal/user';
import type { IRecipe } from '@/models/types/recipes/recipe';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { isAccountActiveFilter, matchesSession } from '@/lib/auth/policy';

async function mutationBudget(user: IUser, action: 'create' | 'update' | 'delete') {
    const policy = action === 'create' ? { limit: 60, windowMs: 3600_000 } : action === 'update' ? { limit: 60, windowMs: 60_000 } : { limit: 20, windowMs: 60_000 };
    if (!(await consumeRateLimit(`recipe:${action}:${user._id}`, policy)).allowed) throw new Error('Recipe change limit reached; please try again later');
}

async function ingredientRecords(ingredients: ReturnType<typeof validatedRecipeInput>['ingredients'], session?: ClientSession) {
    const result = [];
    for (const ing of ingredients) {
        const query = ing.ingredientId ? Ingredient.findById(ing.ingredientId) : Ingredient.findOne({ ingredient: ing.ingredient });
        const existing = await (session ? query.session(session) : query);
        const ingredient = existing || (session ? (await Ingredient.create([{ ingredient: ing.ingredient }], { session }))[0] : await Ingredient.create({ ingredient: ing.ingredient }));
        result.push({ ingredientId: String(ingredient._id), ingredient: ingredient.ingredient, quantity: ing.quantity });
    }
    return result;
}

async function verifiedViewerIds(viewers: string[], session: ClientSession) {
    if (!viewers.length) return [];
    const ids = viewers.filter(value => Types.ObjectId.isValid(value));
    const emails = viewers.filter(value => !Types.ObjectId.isValid(value));
    const users = await User.find({ emailVerifiedAt: { $ne: null }, $and: [isAccountActiveFilter(), { $or: [{ _id: { $in: ids } }, { email: { $in: emails } }] }] }).select('_id email').session(session).lean();
    if (viewers.some(value => !users.some(user => String(user._id) === value || user.email === value))) throw new Error('Private viewers must have verified RecipeSafe accounts');
    return [...new Set(users.map(user => String(user._id)))];
}

async function withRecipeTransaction<T>(existing: ClientSession | undefined, mutate: (session: ClientSession) => Promise<T>): Promise<T> {
    if (existing) return mutate(existing);
    const session = await mongoose.startSession();
    try { return await session.withTransaction(() => mutate(session)); }
    finally { await session.endSession(); }
}

async function lockRecipeOwner(actor: IUser, session: ClientSession) {
    const user = await User.findById(actor._id).select('+sessionVersion').session(session);
    if (!matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion })) throw new Error('Your session changed. Sign in again');
    // This write serializes recipe mutations with account closure/purge, including transactions that retry.
    const version = user!.sessionVersion ?? 0;
    const result = await User.updateOne({ _id: actor._id, $and: [isAccountActiveFilter(),
        { $or: [{ sessionVersion: version }, ...(version === 0 ? [{ sessionVersion: { $exists: false } }] : [])] }] },
        { $inc: { __v: 1 } }, { session });
    if (!result.modifiedCount) throw new Error('Your session changed. Sign in again');
}

function recipeVersionGuard(recipe: { __v?: number }) {
    return recipe.__v === undefined ? { $or: [{ __v: { $exists: false } }, { __v: 0 }] } : { __v: recipe.__v };
}

export async function createRecipeForUser(user: IUser, input: unknown, familyId?: string, session?: ClientSession) {
    await mutationBudget(user, 'create');
    const values = validatedRecipeInput(input);
    return withRecipeTransaction(session, async transaction => {
        await lockRecipeOwner(user, transaction);
        const viewers = await verifiedViewerIds(values.secretViewerIDs, transaction);
        const id = new Types.ObjectId().toString();
        const image = await claimRecipeImage(String(user._id), id, values, undefined, transaction);
        const document = { ...values, secretViewerIDs: viewers, ...image, _id: id, ingredients: await ingredientRecords(values.ingredients, transaction), creatorID: String(user._id), collectionOrigin: familyId ? 'family' : 'personal', originFamilyID: familyId || '', familySharingVersion: 0, reviews: [], favoriteCount: 0, saveCount: 0 };
        const recipe = (await Recipe.create([document], { session: transaction }))[0];
        await User.updateOne({ _id: user._id }, { $addToSet: { recipeIDs: id } }, { session: transaction });
        return recipe;
    });
}

export async function updateRecipeForUser(user: IUser, id: string, input: unknown) {
    await mutationBudget(user, 'update');
    if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) throw new Error('Invalid recipe ID');
    const values = validatedRecipeInput(input);
    const result = await withRecipeTransaction(undefined, async session => {
        await lockRecipeOwner(user, session);
        const existing = await Recipe.findOne({ _id: id, creatorID: String(user._id) }).session(session).lean<IRecipe & { __v?: number }>();
        if (!existing) throw new Error('Only the recipe creator can edit this recipe');
        const viewers = await verifiedViewerIds(values.secretViewerIDs, session);
        const image = await claimRecipeImage(String(user._id), id, values, existing, session);
        const viewerSet = (viewers: string[] = []) => [...new Set(viewers)].sort().join('\n');
        const privacyChanged = (existing.secret === true) !== values.secret || viewerSet(existing.secretViewerIDs) !== viewerSet(viewers);
        const recipe = await Recipe.findOneAndUpdate(
            { _id: id, creatorID: String(user._id), ...recipeVersionGuard(existing) },
            { $set: { ...values, secretViewerIDs: viewers, ...image, ingredients: await ingredientRecords(values.ingredients, session) }, $inc: { __v: 1, ...(privacyChanged ? { familySharingVersion: 1 } : {}) } },
            { new: true, runValidators: true, session },
        );
        if (!recipe) throw new Error('Recipe changed; reload it before saving again');
        const oldKey = existing.imageKey || getUploadThingKeyFromUrl(existing.image);
        const releasedKey = oldKey && oldKey !== image.imageKey ? oldKey : '';
        if (releasedKey) await releaseRecipeImage(releasedKey, id, session);
        return { recipe, releasedKey };
    });
    if (result.releasedKey) {
        // External storage is changed only after the database transaction has committed.
        try { await deleteOwnedUploads([result.releasedKey], String(user._id)); } catch { /* retain for admin cleanup */ }
    }
    return result.recipe;
}

export async function deleteRecipesForUser(user: IUser, ids: unknown) {
    await mutationBudget(user, 'delete');
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !Types.ObjectId.isValid(id))) throw new Error('Select valid recipe IDs (at most 100)');
    const uniqueIds = [...new Set(ids)] as string[];
    const releasedKeys = await withRecipeTransaction(undefined, async session => {
        await lockRecipeOwner(user, session);
        const owned = await Recipe.find({ _id: { $in: uniqueIds }, creatorID: String(user._id) }).select('_id image imageKey __v').session(session).lean<(IRecipe & { __v?: number })[]>();
        if (owned.length !== uniqueIds.length) throw new Error('Only recipes you created can be deleted');
        const posts = await Post.find({ relatedToType: 'recipe', relatedToID: { $in: uniqueIds } }).select('_id').session(session).lean();
        const postIds = posts.map(post => String(post._id));
        const removed = await Recipe.deleteMany({ creatorID: String(user._id), $or: owned.map(recipe => ({ _id: recipe._id, ...recipeVersionGuard(recipe) })) }, { session });
        if (removed.deletedCount !== uniqueIds.length) throw new Error('Recipe changed; reload it before deleting again');
        await User.updateMany({}, { $pull: { recipeIDs: { $in: uniqueIds }, savedRecipeIDs: { $in: uniqueIds }, favoriteRecipeIDs: { $in: uniqueIds } } }, { session });
        await Family.updateMany({}, { $pull: { recipeIDs: { $in: uniqueIds } } }, { session });
        await Community.updateMany({}, { $pull: { recipeIDs: { $in: uniqueIds }, postIDs: { $in: postIds } } }, { session });
        if (postIds.length) await Post.deleteMany({ _id: { $in: postIds } }, { session });
        const keys: string[] = [];
        for (const recipe of owned) {
            const key = recipe.imageKey || getUploadThingKeyFromUrl(recipe.image);
            await releaseRecipeImage(key, String(recipe._id), session);
            if (key) keys.push(key);
        }
        return keys;
    });
    for (const key of [...new Set(releasedKeys)]) {
        try { await deleteOwnedUploads([key], String(user._id)); } catch { /* retain for admin cleanup */ }
    }
}
