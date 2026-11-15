import mongoose, { Schema, type Model } from 'mongoose';

export interface IRecipeTransfer {
    _id: string;
    recipeID: string;
    fromUserID: string;
    toUserID: string;
    familyID: string;
    sharingVersion: number;
    recipeVersion: number;
    status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
    expiresAt: Date;
    respondedAt?: Date;
    createdAt: Date;
}

const schema = new Schema<IRecipeTransfer>({
    recipeID: { type: String, required: true, immutable: true },
    fromUserID: { type: String, required: true, immutable: true },
    toUserID: { type: String, required: true, immutable: true },
    familyID: { type: String, required: true, immutable: true },
    sharingVersion: { type: Number, required: true, immutable: true },
    recipeVersion: { type: Number, required: true, immutable: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'cancelled', 'expired'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    respondedAt: Date,
}, { timestamps: true });

schema.index({ recipeID: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
schema.index({ fromUserID: 1, createdAt: -1 });
schema.index({ toUserID: 1, createdAt: -1 });
// Keep accepted receipts; expiry disables offers without deleting their audit records.
schema.index({ status: 1, expiresAt: 1 });
const RecipeTransfer = (mongoose.models.RecipeTransfer || mongoose.model<IRecipeTransfer>('RecipeTransfer', schema)) as Model<IRecipeTransfer>;
export default RecipeTransfer;
