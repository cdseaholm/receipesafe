import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { UploadThingError } from 'uploadthing/server';
import mongoose from 'mongoose';
import { getCurrentUser } from '@/lib/auth/current-user';
import { isAccountActive, isAccountRecoverable } from '@/lib/auth/policy';
import connectDB from '@/lib/mongodb';
import Upload from '@/models/upload';
import User from '@/models/user';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { cleanupRejectedUpload } from '@/lib/upload-callback-cleanup';

type CompletedFile = { key: string; ufsUrl: string };

async function recordCompletedUpload(userId: string, file: CompletedFile) {
    await connectDB();
    const session = await mongoose.startSession();
    let accepted = false;
    try {
        accepted = Boolean(await session.withTransaction(async () => {
            const user = await User.findById(userId).session(session);
            if (!user?.emailVerifiedAt || !(isAccountActive(user) || isAccountRecoverable(user))) return false;
            // Serialize callback registration against account closure, purge and recovery.
            const locked = await User.updateOne({ _id: userId }, { $inc: { __v: 1 } }, { session });
            if (locked.modifiedCount !== 1) throw new UploadThingError('Account changed; retry upload completion');
            const existing = await Upload.findOne({ key: file.key }).session(session);
            if (existing) return existing.state === 'active';
            await Upload.updateOne({ key: file.key }, { $setOnInsert: {
                key: file.key, ownerId: userId, url: file.ufsUrl, recipeIds: [], state: 'active',
            } }, { upsert: true, session });
            return true;
        }));
    } finally { await session.endSession(); }
    if (!accepted) {
        // Storage calls stay outside Mongo transactions. The tombstone prevents resurrection on retry.
        await cleanupRejectedUpload(userId, file);
        throw new UploadThingError('This account no longer accepts this upload');
    }
}

const f = createUploadthing();
export const ourFileRouter = {
    imageUploader: f({ image: { maxFileSize: '4MB', maxFileCount: 1 } })
        .middleware(async () => {
            const user = await getCurrentUser();
            if (!user) throw new UploadThingError('Unauthorized');
            await connectDB();
            const quota = await consumeRateLimit(`upload:${user._id}`, { limit: 40, windowMs: 3600000 });
            if (!quota.allowed) throw new UploadThingError('Upload limit reached; try again later');
            return { userId: String(user._id) };
        })
        .onUploadComplete(async ({ metadata, file }) => {
            await recordCompletedUpload(metadata.userId, file);
            return { uploadedBy: metadata.userId };
        }),
} satisfies FileRouter;
export type OurFileRouter = typeof ourFileRouter;
