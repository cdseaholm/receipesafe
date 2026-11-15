'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import connectDB from '@/lib/mongodb';
import Family from '@/models/family';
import User from '@/models/user';
import { getCurrentUser } from '@/lib/auth/current-user';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import type { FamilyFormType } from '@/components/forms/family/familyForm';
import type { IFamily } from '@/models/types/family/family';
import { getRevalidationPath } from './utils';
import { matchesSession } from '@/lib/auth/policy';

export async function CreateFamily(data: FamilyFormType, route = '/u/profile'): Promise<{ success: boolean; message: string; family: IFamily | null }> {
    const actor = await getCurrentUser();
    if (!actor) return { success: false, message: 'Sign in with a verified account', family: null };
    if (typeof data?.name !== 'string' || !data.name.trim() || data.name.trim().length > 100) return { success: false, message: 'Family name must be 1–100 characters', family: null };
    if (!(await consumeRateLimit(`family-create:${actor._id}`, { limit: 5, windowMs: 3600_000 })).allowed) return { success: false, message: 'Please wait before creating another family', family: null };
    await connectDB();
    const session = await mongoose.startSession();
    let created: IFamily | null = null;
    try {
        await session.withTransaction(async () => {
            const user = await User.findById(actor._id).select('+sessionVersion').session(session);
            if (!matchesSession(user, { id: String(actor._id), sessionVersion: actor.sessionVersion ?? 0 })
                || !user || user.userFamilyID) throw new Error('You already belong to a family or need to verify your account');
            const [family] = await Family.create([{
                name: data.name.trim(), recipeIDs: [],
                heritage: Array.isArray(data.heritage) ? data.heritage.slice(0, 20).filter(item => typeof item?.name === 'string' && typeof item.flagCode === 'string' && /^[A-Za-z0-9_-]{2,8}$/.test(item.flagCode)).map(item => ({ name: item.name.slice(0, 80), flagCode: item.flagCode })) : [],
                familyMembers: [{ familyMemberName: user.name, familyMemberEmail: user.email, familyMemberID: String(user._id), permissionStatus: 'Admin', memberConnected: true }],
            }], { session });
            user.userFamilyID = String(family._id);
            await user.save({ session });
            created = JSON.parse(JSON.stringify(family)) as IFamily;
        });
        revalidatePath(getRevalidationPath(route));
        return { success: true, message: 'Family created successfully', family: created };
    } catch (error) {
        console.error('Family creation failed', error);
        return { success: false, message: 'Unable to create family. Check that you do not already belong to one and retry.', family: null };
    } finally { await session.endSession(); }
}
