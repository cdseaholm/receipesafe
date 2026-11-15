import 'server-only';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth-options';
import { matchesSession } from './policy';
import User from '@/models/user';
import connectDB from '@/lib/mongodb';
import type { IUser } from '@/models/types/personal/user';

export async function getCurrentUser({includePassword = false}: {includePassword?: boolean} = {}): Promise<IUser | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id || !/^[a-f\d]{24}$/i.test(id)) return null;
  await connectDB();
  const user = await User.findById(id).select(`+sessionVersion${includePassword ? ' +password' : ''}`);
  return matchesSession(user, {id, sessionVersion: session?.user?.sessionVersion}) ? user as IUser : null;
}
export async function requireAuthenticatedUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Unauthorized');
  return user;
}
