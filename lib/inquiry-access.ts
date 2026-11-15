import type { IUser } from '@/models/types/personal/user';
import { isInquiryAdmin } from '@/lib/admin';

export function inquiryAccessFilter(user: Pick<IUser, '_id' | 'emailVerifiedAt'>) {
    return isInquiryAdmin(user) ? {} : { inquirerUserID: String(user._id) };
}
