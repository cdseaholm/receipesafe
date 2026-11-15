import 'server-only';
import mongoose, { type ClientSession } from 'mongoose';
import connectDB from '@/lib/mongodb';
import User from '@/models/user';
import Family from '@/models/family';
import Recipe from '@/models/recipe';
import Upload from '@/models/upload';
import RecipeTransfer from '@/models/recipe-transfer';
import type { IUser } from '@/models/types/personal/user';
import type { IRecipe } from '@/models/types/recipes/recipe';
import type { IFamily } from '@/models/types/family/family';
import { connectedFamilyMember } from '@/lib/family-policy';
import { isAccountActive, isAccountRecoverable, matchesSession } from '@/lib/auth/policy';
import { verifyCurrentPassword } from '@/lib/auth/password';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getUploadThingKeyFromUrl } from '@/utils/uploadthing/file-key';

const OFFER_LIFETIME = 7 * 24 * 60 * 60_000;
type VersionedRecipe = IRecipe & { __v?: number };
export class RecipeTransferError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
function reject(message: string, status = 409): never { throw new RecipeTransferError(message, status); }
const validID = (id: unknown): id is string => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const recipeVersionGuard = (recipe: VersionedRecipe) => recipe.__v === undefined
    ? { $or: [{ __v: { $exists: false } }, { __v: 0 }] } : { __v: recipe.__v };
const verifiedActive = (user: IUser | null): user is IUser => Boolean(user?.emailVerifiedAt && isAccountActive(user));

async function freshActor(actor: IUser, session?: ClientSession) {
    const query = User.findById(actor._id).select('+sessionVersion');
    const user = await (session ? query.session(session) : query);
    if (!matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion })) reject('Your session changed. Sign in again.', 401);
    return user!;
}

function eligibleRecipient(user: IUser | null, family: IFamily, fromID: string): user is IUser {
    return verifiedActive(user) && String(user._id) !== fromID && user.userFamilyID === String(family._id)
        && connectedFamilyMember(family, user._id)?.permissionStatus === 'Admin';
}

/** A shared file must keep its owner. Only a file exclusively reserved to this recipe can move. */
async function exclusiveImage(recipe: VersionedRecipe, ownerID: string, session: ClientSession) {
    if (recipe.steps?.some(step => step.image?.trim() && step.image.trim() !== recipe.image)) {
        reject('Remove separate step images before transferring this recipe. Their ownership cannot be verified.');
    }
    if (!recipe.image && !recipe.imageKey) return null;
    const key = recipe.imageKey || getUploadThingKeyFromUrl(recipe.image);
    if (!key || !recipe.image) reject('Remove this recipe image or upload a new image used only by this recipe before transferring.');
    const upload = await Upload.findOne({ key, ownerId: ownerID, url: recipe.image, state: 'active', recipeIds: [String(recipe._id)] }).session(session);
    if (!upload) reject('Remove this recipe image or upload a new image used only by this recipe before transferring.');
    // Include legacy/signed URL forms and step images, which may have no imageKey reservation.
    const reference = new RegExp(`/f/${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`);
    const otherRecipe = await Recipe.exists({ _id: { $ne: recipe._id }, $or: [
        { imageKey: key }, { image: recipe.image }, { image: reference }, { 'steps.image': recipe.image }, { 'steps.image': reference },
    ] }).session(session);
    const avatar = await User.exists({ $or: [{ profileImage: recipe.image }, { profileImage: reference }] }).session(session);
    if (otherRecipe || avatar) reject('This image is shared with another recipe or avatar. Remove it or upload a separate image before transferring.');
    return { key, url: recipe.image };
}

async function budget(actor: IUser) {
    if (!(await consumeRateLimit(`recipe:transfer:${actor._id}`, { limit: 20, windowMs: 15 * 60_000 })).allowed) reject('Please wait before changing more recipe transfers.', 429);
}

export async function offerRecipeTransfer(actor: IUser, input: { recipeID: unknown; toUserID: unknown; password: unknown }) {
    if (!validID(input.recipeID) || !validID(input.toUserID) || input.toUserID === String(actor._id)) reject('Select a recipe and a different family admin.', 400);
    await budget(actor);
    if (!await verifyCurrentPassword(String(actor._id), input.password)) reject('Current password is incorrect. Google-only accounts can use email recovery to set a password first.', 403);
    await connectDB();
    const session = await mongoose.startSession();
    try {
        return await session.withTransaction(async () => {
            const owner = await freshActor(actor, session);
            const family = validID(owner.userFamilyID) ? await Family.findOne({ _id: owner.userFamilyID, deletedAt: null }).session(session) : null;
            if (!family || !connectedFamilyMember(family, owner._id)) reject('You must belong to an active family to offer a recipe.');
            const recipient = await User.findById(input.toUserID).session(session);
            if (!eligibleRecipient(recipient, family, String(owner._id))) reject('Choose a connected, verified admin of your current family.');
            const recipe = await Recipe.findOne({ _id: input.recipeID, creatorID: String(owner._id) }).session(session).lean<VersionedRecipe>();
            if (!recipe || !family.recipeIDs?.includes(String(recipe._id))) reject('Only your recipes already shared with this family can be transferred.');
            await exclusiveImage(recipe, String(owner._id), session);
            const now = new Date();
            await RecipeTransfer.updateMany({ recipeID: input.recipeID, status: 'pending', expiresAt: { $lte: now } }, { $set: { status: 'expired', respondedAt: now } }, { session });
            if (await RecipeTransfer.exists({ recipeID: input.recipeID, status: 'pending' }).session(session)) reject('Cancel the existing offer before choosing another admin.');
            // These writes serialize authorization against closure, role changes, sharing and editing.
            await User.updateOne({ _id: owner._id }, { $inc: { __v: 1 } }, { session });
            await User.updateOne({ _id: recipient!._id }, { $inc: { __v: 1 } }, { session });
            await Family.updateOne({ _id: family._id }, { $inc: { __v: 1 } }, { session });
            const guarded = await Recipe.updateOne({ _id: recipe._id, creatorID: String(owner._id), ...recipeVersionGuard(recipe) }, { $inc: { __v: 1 } }, { session });
            if (guarded.modifiedCount !== 1) reject('The recipe changed. Reload it before offering a transfer.');
            const [offer] = await RecipeTransfer.create([{
                recipeID: String(recipe._id), fromUserID: String(owner._id), toUserID: String(recipient!._id), familyID: String(family._id),
                sharingVersion: recipe.familySharingVersion || 0, recipeVersion: (recipe.__v || 0) + 1,
                status: 'pending', expiresAt: new Date(now.getTime() + OFFER_LIFETIME),
            }], { session });
            return { transferID: String(offer._id), expiresAt: offer.expiresAt };
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000) reject('A transfer is already pending for this recipe.');
        throw error;
    } finally { await session.endSession(); }
}

export async function respondRecipeTransfer(actor: IUser, input: { transferID: unknown; action: 'accept' | 'decline' | 'cancel' }) {
    if (!validID(input.transferID) || !['accept', 'decline', 'cancel'].includes(input.action)) reject('Invalid recipe transfer.', 400);
    await budget(actor);
    await connectDB();
    const session = await mongoose.startSession();
    try {
        return await session.withTransaction(async () => {
            const recipient = await freshActor(actor, session);
            const offer = await RecipeTransfer.findById(input.transferID).session(session);
            const isSender = offer?.fromUserID === String(recipient._id);
            const isRecipient = offer?.toUserID === String(recipient._id);
            if (!offer || (input.action === 'cancel' ? !isSender : !isRecipient)) reject('Recipe transfer not found.', 404);
            if (offer!.status !== 'pending' || new Date(offer!.expiresAt).getTime() <= Date.now()) reject('This offer has expired or has already been resolved.');
            const now = new Date();
            if (input.action === 'accept') {
                const family = await Family.findOne({ _id: offer!.familyID, deletedAt: null }).session(session);
                if (!family || !eligibleRecipient(recipient, family, offer!.fromUserID)) reject('Only the selected, connected admin of the same active family can accept.');
                const owner = await User.findById(offer!.fromUserID).session(session);
                // Closure detaches membership; a trusted offer survives only until its owner's recovery deadline.
                if (!owner?.emailVerifiedAt || !(isAccountRecoverable(owner) || (isAccountActive(owner)
                    && owner.userFamilyID === offer!.familyID && connectedFamilyMember(family, owner._id)))) reject('The creator is no longer eligible to transfer this recipe.');
                const recipe = await Recipe.findOne({ _id: offer!.recipeID, creatorID: offer!.fromUserID }).session(session).lean<VersionedRecipe>();
                if (!recipe || !family.recipeIDs?.includes(String(recipe._id)) || (recipe.familySharingVersion || 0) !== offer!.sharingVersion
                    || (recipe.__v || 0) !== offer!.recipeVersion) reject('The recipe, its privacy, or its family sharing changed. Ask the creator for a new offer.');
                const image = await exclusiveImage(recipe, offer!.fromUserID, session);
                if (image) {
                    const transferred = await Upload.updateOne({ key: image.key, ownerId: offer!.fromUserID, url: image.url, state: 'active', recipeIds: [String(recipe._id)] },
                        { $set: { ownerId: offer!.toUserID } }, { session, runValidators: true });
                    if (transferred.modifiedCount !== 1) reject('Image ownership changed. Ask the creator for a new offer.');
                }
                const moved = await Recipe.updateOne({ _id: recipe._id, creatorID: offer!.fromUserID, ...recipeVersionGuard(recipe) }, {
                    $set: { creatorID: offer!.toUserID, collectionOrigin: 'family', originFamilyID: offer!.familyID },
                    $inc: { __v: 1, familySharingVersion: 1 },
                }, { session });
                if (moved.modifiedCount !== 1) reject('The recipe changed. Ask the creator for a new offer.');
                await User.updateOne({ _id: owner._id }, { $pull: { recipeIDs: String(recipe._id) }, $inc: { __v: 1 } }, { session });
                await User.updateOne({ _id: recipient._id }, { $addToSet: { recipeIDs: String(recipe._id) }, $inc: { __v: 1 } }, { session });
                await Family.updateOne({ _id: family._id }, { $inc: { __v: 1 } }, { session });
            } else {
                await User.updateOne({ _id: recipient._id }, { $inc: { __v: 1 } }, { session });
            }
            const status = input.action === 'accept' ? 'accepted' : input.action === 'cancel' ? 'cancelled' : 'declined';
            const resolved = await RecipeTransfer.updateOne({ _id: offer!._id, status: 'pending', expiresAt: { $gt: now } }, { $set: { status, respondedAt: now } }, { session });
            if (resolved.modifiedCount !== 1) reject('This offer has already been resolved.');
            return { status };
        });
    } finally { await session.endSession(); }
}

export async function listRecipeTransfers(actor: IUser) {
    await connectDB();
    const user = await freshActor(actor);
    const family = validID(user.userFamilyID) ? await Family.findOne({ _id: user.userFamilyID, deletedAt: null }).lean() : null;
    const linked = family && connectedFamilyMember(family, user._id) ? family : null;
    const recipes = linked ? await Recipe.find({ _id: { $in: linked.recipeIDs || [] }, creatorID: String(user._id) }).select('_id name').lean() : [];
    const adminIDs = linked?.familyMembers.filter(member => member.memberConnected && member.permissionStatus === 'Admin'
        && member.familyMemberID !== String(user._id)).map(member => member.familyMemberID) || [];
    const admins = linked ? (await User.find({ _id: { $in: adminIDs }, userFamilyID: String(linked._id), emailVerifiedAt: { $ne: null } }).select('_id name accountStatus').lean()).filter(verifiedActive) : [];
    const offers = await RecipeTransfer.find({ $or: [{ fromUserID: String(user._id) }, { toUserID: String(user._id) }] }).sort({ createdAt: -1 }).limit(50).lean();
    const visibleRecipes = await Recipe.find({ _id: { $in: offers.map(offer => offer.recipeID) }, $or: [
        { creatorID: String(user._id) }, ...(linked ? [{ _id: { $in: linked.recipeIDs || [] } }] : []),
    ] }).select('_id name').lean();
    const users = await User.find({ _id: { $in: offers.flatMap(offer => [offer.fromUserID, offer.toUserID]) } }).select('_id name').lean();
    const now = Date.now();
    return {
        recipes: recipes.map(recipe => ({ id: String(recipe._id), name: recipe.name || 'Untitled recipe' })),
        admins: admins.map(admin => ({ id: String(admin._id), name: admin.name })),
        offers: offers.map(offer => ({
            id: String(offer._id), direction: offer.fromUserID === String(user._id) ? 'outgoing' : 'incoming',
            recipeName: visibleRecipes.find(recipe => String(recipe._id) === offer.recipeID)?.name || 'Recipe no longer available',
            otherName: users.find(person => String(person._id) === (offer.fromUserID === String(user._id) ? offer.toUserID : offer.fromUserID))?.name || 'Former member',
            status: offer.status === 'pending' && new Date(offer.expiresAt).getTime() <= now ? 'expired' : offer.status,
            expiresAt: offer.expiresAt,
        })),
    };
}
