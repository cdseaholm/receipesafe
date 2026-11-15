import mongoose, { Model, Schema } from "mongoose";
import { IFamily } from "./types/family/family";
import { heritageSchema } from "./heritage";
import { familyMemberSchema } from "./familyMember";

export const familySchema = new Schema(
    {
        name: {
            type: String,
            required: false,
        },
        heritage: {
            type: [heritageSchema],
            required: false,
        },
        recipeIDs: {
            type: [String],
            required: false,
        },
        familyMembers: {
            type: [familyMemberSchema],
            required: false
        },
        deletedAt: { type: Date, default: null },
        restoreUntil: { type: Date },
        deletedByUserID: { type: String, default: '' },
        familyOriginRecipeIDs: { type: [String], default: [] },
        familyRecipeShareVersions: { type: [{ recipeID: String, version: Number }], default: [] },
    },
    {
        timestamps: true,
        optimisticConcurrency: true,
    }
);

// Only archived families have this date. MongoDB removes the archive after 30 days.
familySchema.index({ restoreUntil: 1 }, { expireAfterSeconds: 0 });

const Family = mongoose.models?.Family || mongoose.model("Family", familySchema);

export default Family as Model<IFamily>;
