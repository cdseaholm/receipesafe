import { accountJSON } from '@/lib/auth/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { validEmail } from '@/lib/auth/policy';
import { updateProfile } from '@/lib/auth/profile';
import { hashPassword, verifyCurrentPassword } from '@/lib/auth/password';
import { issueVerification } from '@/lib/auth/verification';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import User from '@/models/user';
import { isSameOriginJSON } from '@/lib/security/request';
export async function PUT(req: NextRequest) {
  if (!isSameOriginJSON(req)) return NextResponse.json({status: 403, message: 'Invalid request origin'}, {status: 403});
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({status: 401, message: 'Unauthorized'}, {status: 401});
  const limit = await consumeRateLimit(`account:update:${user._id}`, {limit: 10, windowMs: 15 * 60_000});
  if (!limit.allowed) return NextResponse.json({status: 429, message: 'Please wait before trying again'}, {status: 429});
  try {
    const {which, itemToEdit, passwordEntered} = await accountJSON(req);
    if (which === 'name' || which === 'bio' || which === 'profileImage') {
      await updateProfile(user, {[which]: itemToEdit});
      return NextResponse.json({status: 200, message: 'Profile updated'});
    }
    if (which !== 'email' && which !== 'password') return NextResponse.json({status: 400, message: 'Invalid field'}, {status: 400});
    if (!await verifyCurrentPassword(String(user._id), passwordEntered)) return NextResponse.json({status: 403, message: 'Current password is incorrect. Google-only accounts can use email recovery to set a password first.'}, {status: 403});
    if (which === 'email') {
      const email = validEmail(itemToEdit);
      if (!email || email === user.email) return NextResponse.json({status: 400, message: 'Enter a different valid email address'}, {status: 400});
      if (await User.exists({email})) return NextResponse.json({status: 409, message: 'That email is unavailable'}, {status: 409});
      await issueVerification(String(user._id), 'email-change', email);
      return NextResponse.json({status: 200, message: 'Check the new address to confirm the change. Your current address remains active until confirmation.'});
    }
    const password = await hashPassword(itemToEdit);
    await User.updateOne({_id: user._id}, {$set: {password}, $inc: {sessionVersion: 1},
      $unset: {emailVerificationTokenHash: '', emailVerificationExpiresAt: '', emailVerificationPurpose: '', pendingEmail: '', resetPasswordToken: '', resetPasswordExpires: ''}});
    return NextResponse.json({status: 200, message: 'Password changed. Sign in again.', signInRequired: true});
  } catch (error) {
    return NextResponse.json({status: 400, message: error instanceof Error ? error.message : 'Unable to update account'}, {status: 400});
  }
}
