import { cache } from 'react';
import { IUser } from "@/models/types/personal/user";
import { getCurrentUser } from '@/lib/auth/current-user';
import { toCurrentUserDTO } from '@/lib/security/user-dto';

export const getSessionUser = cache(async (): Promise<IUser | null> => {
    const user = await getCurrentUser();
    return user ? toCurrentUserDTO(user) : null;
});
