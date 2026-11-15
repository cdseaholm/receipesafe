import 'server-only';
import { compare, hash } from 'bcrypt-ts';
import User from '@/models/user';
import connectDB from '@/lib/mongodb';
import { isAccountActive, safeStoredPasswordHash, validNewPassword } from './policy';
import { consumeRateLimit } from '@/lib/security/rate-limit';

export async function hashPassword(password: unknown) {
  if (!validNewPassword(password)) throw new Error('Use at least 12 characters and no more than 72 UTF-8 bytes');
  return hash(password, 10);
}

export async function verifyPassword(password: unknown, storedHash: unknown) {
  if (typeof password !== 'string' || new TextEncoder().encode(password).length > 72 || !safeStoredPasswordHash(storedHash)) return false;
  return compare(password, storedHash);
}

export async function verifyCurrentPassword(userId: string, password: unknown) {
  if (!(await consumeRateLimit(`password-confirm:${userId}`, {limit: 10, windowMs: 15 * 60_000})).allowed) return false;
  await connectDB();
  const user = await User.findById(userId).select('+password');
  return Boolean(isAccountActive(user) && user && await verifyPassword(password, user.password));
}
