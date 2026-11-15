import Upload from '@/models/upload';
import Recipe from '@/models/recipe';
import User from '@/models/user';
import { getUploadThingKeyFromUrl } from '@/utils/uploadthing/file-key';
import { UTApi } from 'uploadthing/server';
import type { ClientSession } from 'mongoose';

type ImageReference = { image?: string; imageKey?: string };

export async function claimRecipeImage(ownerId: string, recipeId: string, value: ImageReference, existing?: ImageReference, session?: ClientSession) {
    const image = typeof value.image === 'string' ? value.image.trim() : '';
    const imageKey = typeof value.imageKey === 'string' ? value.imageKey.trim() : '';
    if (!image && !imageKey) return { image: '', imageKey: '' };
    const previousKey = existing?.imageKey || getUploadThingKeyFromUrl(existing?.image);
    const desiredKey = imageKey || getUploadThingKeyFromUrl(image);
    // Existing legacy images remain editable, but unverified legacy keys are never deletable.
    if (existing && image === existing.image && desiredKey === previousKey) return { image, imageKey: previousKey };
    if (!image || !desiredKey) throw new Error('Choose an image uploaded by your account');
    const upload = await Upload.findOneAndUpdate(
        { key: desiredKey, ownerId, url: image, state: 'active' },
        { $addToSet: { recipeIds: recipeId } },
        { new: true, session },
    ).lean();
    if (!upload) throw new Error('Choose an image uploaded by your account');
    return { image: upload.url, imageKey: upload.key };
}

export async function releaseRecipeImage(key: string | undefined, recipeId: string, session?: ClientSession) {
    if (key) await Upload.updateOne({ key }, { $pull: { recipeIds: recipeId } }, { session });
}

export async function deleteOwnedUploads(keys: string[], ownerId: string, admin = false) {
    const uniqueKeys = Array.from(new Set(keys.filter(key => typeof key === 'string' && key.length > 0 && key.length <= 512)));
    if (uniqueKeys.length > 100) return { success: false, message: 'Select at most 100 files', deletedCount: 0 };
    let deletedCount = 0;
    for (const key of uniqueKeys) {
        const upload = await Upload.findOneAndUpdate(
            { key, ...(admin ? {} : { ownerId }), state: 'active', recipeIds: { $size: 0 } },
            { $set: { state: 'deleting' } },
            { new: true },
        ).lean();
        if (!upload) continue;
        try {
            // Check legacy/shared references as well as the atomic reservation above.
            const referenced = await Recipe.exists({ $or: [{ imageKey: key }, { image: upload.url }] });
            const avatarReference = await User.exists({ profileImage: upload.url });
            if (referenced || avatarReference) {
                await Upload.updateOne({ key, state: 'deleting' }, { $set: { state: 'active' } });
                continue;
            }
            const result = await new UTApi().deleteFiles([key]);
            if (!result.success) throw new Error('Storage provider rejected deletion');
            await Upload.updateOne({ key, state: 'deleting' }, { $set: { state: 'deleted' } });
            deletedCount += result.deletedCount;
        } catch (error) {
            await Upload.updateOne({ key, state: 'deleting' }, { $set: { state: 'active' } });
            throw error;
        }
    }
    return { success: deletedCount === uniqueKeys.length, message: deletedCount === uniqueKeys.length ? 'Files deleted' : 'Some files are still referenced or have no verified ownership', deletedCount };
}
