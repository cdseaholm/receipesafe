import mongoose, { Model, Schema } from "mongoose";
import { IUser } from "./types/personal/user";

export const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    password: {
      type: String,
      default: '',
      select: false,
    },
    emailVerifiedAt: { type: Date, default: null },
    accountStatus: { type: String, enum: ['active', 'deactivated', 'purging'], default: 'active', index: true },
    deactivatedAt: { type: Date },
    purgeAfter: { type: Date, index: true },
    purgeAttemptedAt: { type: Date, select: false },
    sessionVersion: { type: Number, default: 0, select: false },
    googleProviderId: { type: String, select: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
    emailVerificationPurpose: { type: String, enum: ['verify', 'recover', 'email-change'], select: false },
    pendingEmail: { type: String, select: false },
    userFamilyID: {
      type: String,
      default: ''
    },
    recipeIDs: {
      type: [String],
      default: []
    },
    savedRecipeIDs: {
      type: [String],
      default: []
    },
    favoriteRecipeIDs: {
      type: [String],
      default: []
    },
    communityIDs: {
      type: [String],
      default: []
    },
    resetPasswordToken: {
      type: String,
      default: '',
      select: false,
    },
    resetPasswordExpires: {
      type: String,
      default: '',
      select: false,
    },
    bio: {
      type: String,
      default: '', 
    },
    profileImage: {
      type: String,
      default: '', 
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ emailVerificationTokenHash: 1 }, { sparse: true });
// No TTL on users: the account purge service removes dependent records before deleting identity.
userSchema.index({ accountStatus: 1, purgeAfter: 1 });

const User = mongoose.models?.User || mongoose.model("User", userSchema);

export default User as Model<IUser>;
