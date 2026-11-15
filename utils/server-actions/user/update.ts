'use server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/current-user';
import { updateProfile } from '@/lib/auth/profile';
export async function UpdateUser(userId: string, userData: unknown, route = '/u/profile') {
  try {
    const user = await getCurrentUser();
    if (!user || String(user._id) !== userId) return {success: false, message: 'Unauthorized'};
    await updateProfile(user, userData);
    revalidatePath(route.startsWith('/') && !route.startsWith('//') ? route : '/u/profile');
    return {success: true, message: 'Profile updated'};
  } catch (error) { return {success: false, message: error instanceof Error ? error.message : 'Unable to update profile'}; }
}
