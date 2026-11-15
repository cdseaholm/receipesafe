import { getCurrentUser } from '@/lib/auth/current-user';
import { Types } from 'mongoose';
import { consumeRateLimit } from '@/lib/security/rate-limit';
export { canUserViewRecipe } from '@/lib/recipe-access';


export function isValidId(id: string) {
    return typeof id === 'string' && Types.ObjectId.isValid(id);
}

export function getRevalidationPath(route: string) {
    return route?.startsWith('/') ? route : '/u/recipes';
}

export function cleanStringArray(values: string[] | undefined) {
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean);
}

export async function canAttemptFavoriteToggle(userId: string) {
    return (await consumeRateLimit(`favorite:${userId}`, { limit: 20, windowMs: 60_000 })).allowed;
}

export async function getAuthenticatedUser() {
    const user = await getCurrentUser();
    return { user, message: user ? '' : 'Unauthorized' };
}
