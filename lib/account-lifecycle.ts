import 'server-only';
import mongoose, { type ClientSession } from 'mongoose';
import connectDB from '@/lib/mongodb';
import User from '@/models/user';
import Family from '@/models/family';
import Recipe from '@/models/recipe';
import Community from '@/models/community';
import Post from '@/models/post';
import Invite from '@/models/invite';
import Inquiry from '@/models/inquiry';
import MembershipRequest from '@/models/requests';
import Review from '@/models/review';
import Upload from '@/models/upload';
import RecipeTransfer from '@/models/recipe-transfer';
import { isAccountActiveFilter, matchesSession } from '@/lib/auth/policy';
import { verifyCurrentPassword } from '@/lib/auth/password';
import { COMMUNITIES_ENABLED } from '@/lib/features';
import { UTApi } from 'uploadthing/server';
import { retryRejectedUploadCleanup } from '@/lib/upload-callback-cleanup';
import type { IUser } from '@/models/types/personal/user';

export const ACCOUNT_RECOVERY_MS = 30 * 24 * 60 * 60_000;
const RECIPE_BATCH = 100;
const UPLOAD_BATCH = 25;
export class AccountClosureError extends Error {
    constructor(message: string, public status = 409) { super(message); }
}

/** Also checks inconsistent legacy memberships; a pending admin never replaces a connected admin. */
async function detachActiveMemberships(userId: string, session: ClientSession) {
    const families = await Family.find({ deletedAt: null, 'familyMembers.familyMemberID': userId }).session(session);
    for (const family of families) {
        const removedAdmin = family.familyMembers.some(member => member.familyMemberID === userId && member.memberConnected && member.permissionStatus === 'Admin');
        const remaining = family.familyMembers.filter(member => member.familyMemberID !== userId);
        if (removedAdmin) {
            const admins = remaining.filter(member => member.memberConnected && member.permissionStatus === 'Admin').map(member => member.familyMemberID);
            const replacement = admins.length ? await User.exists({ _id: { $in: admins }, userFamilyID: String(family._id), emailVerifiedAt: { $ne: null }, ...isAccountActiveFilter() }).session(session) : null;
            if (!replacement) throw new AccountClosureError('Assign another connected family admin, or archive the family first, before closing your account.');
        }
        family.familyMembers = remaining;
        await family.save({ session });
    }
    const communities = await Community.find({ $or: [{ creatorID: userId }, { adminIDs: userId }, { communityMemberIDs: userId }] }).session(session);
    for (const community of communities) {
        const admins = [...new Set([community.creatorID, ...community.adminIDs].filter(id => id && id !== userId))];
        if (COMMUNITIES_ENABLED && (community.creatorID === userId || community.adminIDs.includes(userId)) && !admins.length) {
            throw new AccountClosureError('Assign another community admin before closing your account.');
        }
        await Community.updateOne({ _id: community._id }, { $set: {
            creatorID: community.creatorID === userId ? admins[0] || '' : community.creatorID,
            adminIDs: community.adminIDs.filter(id => id !== userId), communityMemberIDs: community.communityMemberIDs.filter(id => id !== userId),
        } }, { session });
    }
}

export async function closeAccount(actor: IUser, input: { password: unknown; confirmation: unknown }, now = new Date()) {
    if (input.confirmation !== 'DELETE') throw new AccountClosureError('Type DELETE to confirm account closure.', 400);
    if (!await verifyCurrentPassword(String(actor._id), input.password)) {
        throw new AccountClosureError('Current password is incorrect. If you sign in with Google, use email recovery to set a password first.', 403);
    }
    await connectDB();
    const session = await mongoose.startSession();
    const purgeAfter = new Date(now.getTime() + ACCOUNT_RECOVERY_MS);
    try {
        await session.withTransaction(async () => {
            const user = await User.findById(actor._id).select('+sessionVersion').session(session);
            if (!matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion })) {
                throw new AccountClosureError('Your session changed. Sign in again.');
            }
            const userId = String(user!._id);
            await detachActiveMemberships(userId, session);
            // Invalidate invitations, but keep trusted outgoing recipe offers until their own expiry.
            await Invite.deleteMany({ $or: [{ email: user!.email }, { invitedByUserID: userId }] }, { session });
            await Family.updateMany({}, { $pull: { familyMembers: { familyMemberEmail: user!.email, memberConnected: false } } }, { session });
            const currentVersion = user!.sessionVersion ?? 0;
            const version = currentVersion === 0 ? { $or: [{ sessionVersion: 0 }, { sessionVersion: { $exists: false } }] } : { sessionVersion: currentVersion };
            const result = await User.updateOne({ _id: user!._id, ...version }, {
                $set: { accountStatus: 'deactivated', deactivatedAt: now, purgeAfter, userFamilyID: '', communityIDs: [] },
                $inc: { sessionVersion: 1 },
                $unset: { emailVerificationTokenHash: '', emailVerificationExpiresAt: '', emailVerificationPurpose: '', pendingEmail: '', resetPasswordToken: '', resetPasswordExpires: '', purgeAttemptedAt: '' },
            }, { session });
            if (result.modifiedCount !== 1) throw new AccountClosureError('Your account changed. Please retry.');
            // Recipe IDs, creator IDs, images, bookmarks and ownership remain intact for recovery.
        });
        return { purgeAfter: purgeAfter.toISOString() };
    } finally { await session.endSession(); }
}

async function removeRecipeBatch(userId: string, session: ClientSession) {
    const recipes = await Recipe.find({ creatorID: userId }).select('_id').limit(RECIPE_BATCH).session(session).lean();
    const ids = recipes.map(recipe => String(recipe._id));
    if (!ids.length) return 0;
    const posts = await Post.find({ relatedToType: 'recipe', relatedToID: { $in: ids } }).select('_id').session(session).lean();
    const postIds = posts.map(post => String(post._id));
    await Recipe.deleteMany({ _id: { $in: ids }, creatorID: userId }, { session });
    await User.updateMany({}, { $pull: { recipeIDs: { $in: ids }, savedRecipeIDs: { $in: ids }, favoriteRecipeIDs: { $in: ids } } }, { session });
    await Family.updateMany({}, { $pull: { recipeIDs: { $in: ids }, familyOriginRecipeIDs: { $in: ids }, familyRecipeShareVersions: { recipeID: { $in: ids } } } }, { session });
    await Community.updateMany({}, { $pull: { recipeIDs: { $in: ids }, postIDs: { $in: postIds } } }, { session });
    if (postIds.length) await Post.deleteMany({ _id: { $in: postIds } }, { session });
    await Upload.updateMany({ recipeIds: { $in: ids } }, { $pull: { recipeIds: { $in: ids } } }, { session });
    return ids.length;
}

/** A crash after provider deletion is safe: the next run retries the same recorded key. */
async function removeAccountUploads(userId: string) {
    const uploads = await Upload.find({ ownerId: userId, state: { $in: ['active', 'deleting'] } }).limit(UPLOAD_BATCH).lean();
    let retained = 0;
    for (const upload of uploads) {
        const claimed = await Upload.findOneAndUpdate({ key: upload.key, ownerId: userId, state: { $in: ['active', 'deleting'] } },
            { $set: { state: 'deleting' } }, { new: true }).lean();
        if (!claimed) continue;
        // Never guess ownership from a URL, nor delete a file another recipe/avatar still references.
        const reference = new RegExp(`/f/${upload.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`);
        if (await Recipe.exists({ $or: [{ imageKey: upload.key }, { image: upload.url }, { image: reference }, { 'steps.image': upload.url }, { 'steps.image': reference }] })
            || await User.exists({ $or: [{ profileImage: upload.url }, { profileImage: reference }] })
            || await Post.exists({ creatorID: { $ne: userId }, $or: [{ image: upload.url }, { image: reference }] })) {
            await Upload.updateOne({ key: upload.key, ownerId: userId, state: 'deleting' }, { $set: { state: 'retained', recipeIds: [] } });
            retained++;
            continue;
        }
        const result = await new UTApi().deleteFiles([upload.key]);
        if (!result.success) throw new Error('Account storage cleanup failed; retry required');
        await Upload.updateOne({ key: upload.key, ownerId: userId, state: 'deleting' }, { $set: { state: 'deleted' } });
    }
    // Shared legacy assets keep their verified, now-tombstoned owner ID; they confer no account access.
    const remaining = await Upload.countDocuments({ ownerId: userId, state: { $in: ['active', 'deleting'] } });
    return { complete: remaining === 0, retained };
}

/** Bounded, idempotent cleanup. The identity remains locked in `purging` on provider/DB failure. */
export async function purgeAccount(userId: string, now = new Date()) {
    await connectDB();
    const session = await mongoose.startSession();
    let claimed = false;
    try {
        await session.withTransaction(async () => {
            claimed = false;
            const user = await User.findOne({ _id: userId, purgeAfter: { $lte: now }, accountStatus: { $in: ['deactivated', 'purging'] } }).session(session);
            if (!user) return;
            // Defense in depth if a legacy/manual record put a sole admin into a closed state.
            await detachActiveMemberships(userId, session);
            await User.updateOne({ _id: user._id }, { $set: { accountStatus: 'purging', profileImage: '', userFamilyID: '' }, $inc: { sessionVersion: 1 } }, { session });
            await RecipeTransfer.updateMany({ status: 'pending', $or: [{ fromUserID: userId }, { toUserID: userId }] }, { $set: { status: 'cancelled', respondedAt: now } }, { session });
            await removeRecipeBatch(userId, session);
            claimed = true;
        });
        if (!claimed) return { purged: false, pending: false, retainedUploads: 0 };
        if (await Recipe.exists({ creatorID: userId })) return { purged: false, pending: true, retainedUploads: 0 };
        const uploads = await removeAccountUploads(userId);
        if (!uploads.complete) return { purged: false, pending: true, retainedUploads: uploads.retained };
        let purged = false;
        await session.withTransaction(async () => {
            purged = false;
            const user = await User.findOne({ _id: userId, accountStatus: 'purging' }).session(session);
            if (!user || await Recipe.exists({ creatorID: userId }).session(session)) return;
            // Clearing the lists and identity in one commit makes counter cleanup retry-safe.
            const saved = (user.savedRecipeIDs || []).filter(id => mongoose.isValidObjectId(id));
            const favorites = (user.favoriteRecipeIDs || []).filter(id => mongoose.isValidObjectId(id));
            await Recipe.updateMany({ _id: { $in: saved }, saveCount: { $gt: 0 } }, { $inc: { saveCount: -1 } }, { session });
            await Recipe.updateMany({ _id: { $in: favorites }, favoriteCount: { $gt: 0 } }, { $inc: { favoriteCount: -1 } }, { session });
            await Recipe.updateMany({}, { $pull: { secretViewerIDs: { $in: [userId, user.email] }, reviews: { authorId: userId } } }, { session });
            await Family.updateMany({}, { $pull: { familyMembers: { $or: [{ familyMemberID: userId }, { familyMemberEmail: user.email, memberConnected: false }] } } }, { session });
            await Family.updateMany({ deletedByUserID: userId }, { $set: { deletedByUserID: '' } }, { session });
            await Invite.deleteMany({ $or: [{ email: user.email }, { invitedByUserID: userId }] }, { session });
            await Inquiry.deleteMany({ $or: [{ inquirerUserID: userId }, { inquirerEmail: user.email }] }, { session });
            const requests = await MembershipRequest.find({ requesterID: userId }).select('_id').session(session).lean();
            await Community.updateMany({}, { $pull: { requestIDs: { $in: requests.map(request => String(request._id)) } } }, { session });
            await MembershipRequest.deleteMany({ requesterID: userId }, { session });
            const reviews = await Review.find({ authorId: userId }).select('_id').session(session).lean();
            const reviewIds = reviews.map(review => String(review._id));
            const posts = await Post.find({ creatorID: userId }).select('_id').session(session).lean();
            await Community.updateMany({}, { $pull: { postIDs: { $in: posts.map(post => String(post._id)) } } }, { session });
            await Post.updateMany({}, { $pull: { commentIDs: { $in: reviewIds }, ratingsIDs: { $in: reviewIds } } }, { session });
            await Post.deleteMany({ creatorID: userId }, { session });
            await Review.deleteMany({ authorId: userId }, { session });
            // Accepted receipts retain only opaque IDs as evidence of the new owner's consent.
            await RecipeTransfer.deleteMany({ status: { $ne: 'accepted' }, $or: [{ fromUserID: userId }, { toUserID: userId }] }, { session });
            await Upload.deleteMany({ ownerId: userId, state: 'deleted' }, { session });
            const result = await User.deleteOne({ _id: userId, accountStatus: 'purging' }, { session });
            if (result.deletedCount !== 1) throw new Error('Account changed during final cleanup; retry required');
            purged = result.deletedCount === 1;
        });
        return { purged, pending: !purged, retainedUploads: uploads.retained };
    } finally { await session.endSession(); }
}

export async function purgeDueAccounts(now = new Date()) {
    await connectDB();
    const due = await User.find({ purgeAfter: { $lte: now }, accountStatus: { $in: ['deactivated', 'purging'] } })
        .select('_id').sort({ purgeAttemptedAt: 1, purgeAfter: 1 }).limit(5).lean();
    const result = { attempted: due.length, purged: 0, pending: 0, failed: 0, retainedUploads: 0 };
    for (const user of due) {
        try {
            // Rotate failures and unfinished batches so older failures cannot starve later accounts.
            await User.updateOne({ _id: user._id, purgeAfter: { $lte: now }, accountStatus: { $in: ['deactivated', 'purging'] } }, { $set: { purgeAttemptedAt: now } });
            const outcome = await purgeAccount(String(user._id), now);
            result.purged += Number(outcome.purged); result.pending += Number(outcome.pending); result.retainedUploads += outcome.retainedUploads;
        } catch (error) {
            result.failed++;
            console.error('Account purge needs retry', String(user._id), error instanceof AccountClosureError ? error.message : 'Cleanup failed');
        }
    }
    const rejectedUploads = await retryRejectedUploadCleanup();
    return { ...result, failed: result.failed + rejectedUploads.failed, rejectedUploads };
}
