import type { IUser } from '@/models/types/personal/user';
import { normalizeId } from '@/lib/data-normalization';
import { COMMUNITIES_ENABLED } from '@/lib/features';

function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function ids(value: unknown) { return Array.isArray(value) ? value.map(normalizeId).filter(Boolean) : []; }
function date(value: unknown) { return value instanceof Date ? value.toISOString() : text(value); }

/** Explicit client boundary: new model fields never become browser fields by default. */
export function toCurrentUserDTO(raw: unknown): IUser {
    const user = raw as Record<string, unknown>;
    return {
        _id: normalizeId(user._id), name: text(user.name), email: text(user.email),
        bio: text(user.bio), profileImage: text(user.profileImage),
        userFamilyID: normalizeId(user.userFamilyID), recipeIDs: ids(user.recipeIDs),
        savedRecipeIDs: ids(user.savedRecipeIDs), favoriteRecipeIDs: ids(user.favoriteRecipeIDs),
        communityIDs: COMMUNITIES_ENABLED ? ids(user.communityIDs) : [], createdAt: date(user.createdAt), updatedAt: date(user.updatedAt),
        password: '', resetPasswordToken: '', resetPasswordExpires: '',
        emailVerifiedAt: date(user.emailVerifiedAt) || undefined,
    };
}

/** Public profiles and community members must not expose emails, relationships or credentials. */
export function toPublicUserDTO(raw: unknown): IUser {
    const user = toCurrentUserDTO(raw);
    return {
        ...user, email: '', userFamilyID: '', recipeIDs: [], savedRecipeIDs: [],
        favoriteRecipeIDs: [], communityIDs: [], createdAt: '', updatedAt: '', emailVerifiedAt: undefined,
    };
}
