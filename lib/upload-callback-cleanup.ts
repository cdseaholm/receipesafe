import 'server-only';
import { UTApi } from 'uploadthing/server';
import connectDB from '@/lib/mongodb';
import Upload from '@/models/upload';
import User from '@/models/user';
import Recipe from '@/models/recipe';
import Post from '@/models/post';

type RecordedFile = { key: string; ownerId: string; url: string };
const reason = 'rejected-callback';

/** Only a signed callback can create this deletion intent; cron uses its trusted recorded fields. */
async function cleanRecordedRejectedFile(file: RecordedFile): Promise<'deleted' | 'retained' | 'skipped'> {
    const filter = { key: file.key, ownerId: file.ownerId, url: file.url, state: 'deleting', cleanupReason: reason };
    const upload = await Upload.findOneAndUpdate(filter, { $set: { cleanupAttemptedAt: new Date() } }, { new: true }).lean();
    if (!upload) return 'skipped';
    const reference = new RegExp(`/f/${file.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`);
    const recipeReference = await Recipe.exists({ $or: [{ imageKey: file.key }, { image: file.url }, { image: reference }, { 'steps.image': file.url }, { 'steps.image': reference }] });
    const avatarReference = await User.exists({ $or: [{ profileImage: file.url }, { profileImage: reference }] });
    const postReference = await Post.exists({ $or: [{ image: file.url }, { image: reference }] });
    if (upload.recipeIds.length || recipeReference || avatarReference || postReference) {
        await Upload.updateOne(filter, { $set: { state: 'retained' } });
        return 'retained';
    }
    const result = await new UTApi().deleteFiles([file.key]);
    if (!result.success) throw new Error('Upload cleanup failed; retry required');
    await Upload.updateOne({ ...filter, recipeIds: { $size: 0 } }, { $set: { state: 'deleted' } });
    return 'deleted';
}

export async function cleanupRejectedUpload(userId: string, file: { key: string; ufsUrl: string }) {
    // $setOnInsert preserves a prior registration, accepted transfer or retained/deleted tombstone.
    await Upload.updateOne({ key: file.key }, { $setOnInsert: {
        key: file.key, ownerId: userId, url: file.ufsUrl, recipeIds: [], state: 'deleting', cleanupReason: reason,
    } }, { upsert: true });
    return cleanRecordedRejectedFile({ key: file.key, ownerId: userId, url: file.ufsUrl });
}

/** Bounded scheduled retry also covers files whose owner identity has already been purged. */
export async function retryRejectedUploadCleanup() {
    await connectDB();
    const candidates = await Upload.find({ cleanupReason: reason, state: 'deleting' })
        .sort({ cleanupAttemptedAt: 1, createdAt: 1 }).limit(25).lean();
    const result = { attempted: candidates.length, deleted: 0, retained: 0, failed: 0 };
    for (const upload of candidates) {
        try {
            const status = await cleanRecordedRejectedFile(upload);
            if (status === 'deleted') result.deleted++;
            else if (status === 'retained') result.retained++;
        } catch { result.failed++; }
    }
    return result;
}
