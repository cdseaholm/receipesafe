'use server'
import { getCurrentUser } from '@/lib/auth/current-user';
import { deleteOwnedUploads } from '@/lib/upload-ownership';
import { getUploadThingKeyFromUrl } from '@/utils/uploadthing/file-key';
type UploadThingFileReference = string | { key?: unknown; fileKey?: unknown; url?: unknown; ufsUrl?: unknown; appUrl?: unknown } | null | undefined;
function normalizeKey(value: UploadThingFileReference) {
    if (typeof value === 'string') return getUploadThingKeyFromUrl(value) || value.trim();
    if (!value || typeof value !== 'object') return '';
    const direct = value.key || value.fileKey;
    if (typeof direct === 'string') return direct.trim();
    const url = value.ufsUrl || value.url || value.appUrl;
    return typeof url === 'string' ? getUploadThingKeyFromUrl(url) : '';
}
export async function DeleteUploadThingFiles(fileKeys: UploadThingFileReference[]) {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: 'Unauthorized' };
    if (!Array.isArray(fileKeys) || fileKeys.length > 100) return { success: false, message: 'Select at most 100 files' };
    try { return await deleteOwnedUploads(fileKeys.map(normalizeKey), String(user._id)); }
    catch { return { success: false, message: 'Failed to delete uploaded files' }; }
}
