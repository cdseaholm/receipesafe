import mongoose, { Schema, type Model } from 'mongoose';

export interface IUpload {
    key: string;
    ownerId: string;
    url: string;
    recipeIds: string[];
    state: 'active' | 'deleting' | 'deleted' | 'retained';
    cleanupReason?: 'rejected-callback';
    cleanupAttemptedAt?: Date;
    createdAt: Date;
}

const uploadSchema = new Schema<IUpload>({
    key: { type: String, required: true, unique: true, immutable: true },
    // Ownership can change only through the exclusive-image transaction in recipe-transfers.
    // Upload callbacks use $setOnInsert so retries cannot reset a transferred owner.
    ownerId: { type: String, required: true, index: true },
    url: { type: String, required: true, immutable: true },
    recipeIds: { type: [String], default: [] },
    // Retained files are legacy references owned by a purged account; no new reservations are allowed.
    state: { type: String, enum: ['active', 'deleting', 'deleted', 'retained'], default: 'active' },
    cleanupReason: { type: String, enum: ['rejected-callback'] },
    cleanupAttemptedAt: Date,
}, { timestamps: true });

uploadSchema.index({ cleanupReason: 1, state: 1, cleanupAttemptedAt: 1 });

const Upload = (mongoose.models.Upload || mongoose.model<IUpload>('Upload', uploadSchema)) as Model<IUpload>;
export default Upload;
