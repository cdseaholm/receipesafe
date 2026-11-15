import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { Resend } from 'resend';
import User from '@/models/user';
import Family from '@/models/family';
import connectDB from '@/lib/mongodb';
import { hashPassword } from './password';
import { isAccountActive, isAccountActiveFilter, isAccountRecoverable, validEmail, validNewPassword } from './policy';
import { consumeRateLimit } from '@/lib/security/rate-limit';

const HOUR = 60 * 60_000;
export const verificationMessage = 'If that account can receive email, a verification or recovery link has been sent. Check your inbox and spam folder.';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function mailConfig() {
  const url = new URL(process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('HTTPS account URL is required');
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error('Account verification email is not configured');
  return {base: url.origin, key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM};
}

export async function issueVerification(userId: string, purpose: 'verify' | 'recover' | 'email-change', email: string, inviteToken?: unknown) {
  const config = mailConfig();
  const user = await User.findById(userId);
  const recoveringAccount = isAccountRecoverable(user);
  if (!user || (!isAccountActive(user) && !(recoveringAccount && purpose === 'recover')) ||
      (purpose !== 'email-change' && email !== user.email)) throw new Error('This account cannot receive that verification link');
  const allowed = await consumeRateLimit(`verification:user:${userId}`, {limit: 3, windowMs: HOUR});
  if (!allowed.allowed) throw new Error('Please wait before requesting another verification email');
  const token = randomBytes(32).toString('hex');
  const digest = tokenHash(token);
  // A closure/purge racing this request must not receive a token for its former active state.
  const eligibility = recoveringAccount
    ? {accountStatus: 'deactivated', purgeAfter: user.purgeAfter, $and: [{purgeAfter: {$gt: new Date()}}]}
    : isAccountActiveFilter();
  const issued = await User.updateOne({_id: userId, email: user.email, ...eligibility}, {$set: {
    emailVerificationTokenHash: digest, emailVerificationExpiresAt: new Date(Date.now() + HOUR),
    emailVerificationPurpose: purpose, ...(purpose === 'email-change' ? {pendingEmail: email} : {}),
  }});
  if (!issued.modifiedCount) throw new Error('This account cannot receive that verification link');
  const fragment = new URLSearchParams({token});
  if (typeof inviteToken === 'string' && /^[a-f\d]{40,128}$/i.test(inviteToken)) fragment.set('invite', inviteToken);
  const link = `${config.base}/verify-email#${fragment}`;
  try {
    const result = await new Resend(config.key).emails.send({from: config.from, to: email,
      subject: purpose === 'email-change' ? 'Confirm your RecipeSafe email change' : 'Verify or recover your RecipeSafe account',
      text: `Open this link to confirm ownership of this email address and choose your password: ${link}\n\nThis link expires in one hour and can be used once.${recoveringAccount ? ` Your account can only be recovered before ${new Date(user.purgeAfter!).toISOString()}, its original 30-day deletion deadline. Recovery preserves your remaining recipes but does not automatically restore family membership.` : ''} If you did not request it, ignore this message.`});
    if (result.error) throw new Error('Verification email could not be sent');
  } catch {
    await User.updateOne({_id: userId, emailVerificationTokenHash: digest}, {$unset: {
      emailVerificationTokenHash: '', emailVerificationExpiresAt: '', emailVerificationPurpose: '', pendingEmail: '',
    }});
    throw new Error('Verification email could not be sent. Please try again later');
  }
}

export async function requestVerification(emailInput: unknown) {
  const email = validEmail(emailInput);
  if (!email) throw new Error('Enter a valid email address');
  mailConfig();
  const allowed = await consumeRateLimit(`verification:email:${email}`, {limit: 3, windowMs: HOUR});
  if (!allowed.allowed) return;
  await connectDB();
  const user = await User.findOne({email});
  if (user && (isAccountActive(user) || isAccountRecoverable(user))) {
    await issueVerification(String(user._id), !isAccountActive(user) || user.emailVerifiedAt ? 'recover' : 'verify', email);
  }
}

export async function registerAccount(input: {name?: unknown; email?: unknown; password?: unknown; inviteToken?: unknown}) {
  const email = validEmail(input.email);
  if (!email || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !validNewPassword(input.password)) {
    throw new Error('Enter a valid name, email and a password of at least 12 characters (maximum 72 UTF-8 bytes)');
  }
  mailConfig();
  const limit = await consumeRateLimit(`register:email:${email}`, {limit: 3, windowMs: HOUR});
  if (!limit.allowed) throw new Error('Please wait before trying to register again');
  await connectDB();
  const existing = await User.findOne({email});
  // Never overwrite an existing account or disclose whether it has been verified.
  if (existing) {
    if (isAccountActive(existing) || isAccountRecoverable(existing)) {
      await issueVerification(String(existing._id), !isAccountActive(existing) || existing.emailVerifiedAt ? 'recover' : 'verify', email, input.inviteToken);
    }
    return;
  }
  const password = await hashPassword(input.password);
  const user = await User.create({name: input.name.trim(), email, password, emailVerifiedAt: null, sessionVersion: 0, accountStatus: 'active'});
  await issueVerification(String(user._id), 'verify', email, input.inviteToken);
}

export async function confirmVerification(token: unknown, newPassword: unknown) {
  if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token) || !validNewPassword(newPassword)) throw new Error('Invalid link or password. Use at least 12 characters and no more than 72 UTF-8 bytes');
  await connectDB();
  const digest = tokenHash(token);
  const filter = {emailVerificationTokenHash: digest, emailVerificationExpiresAt: {$gt: new Date()}};
  const user = await User.findOne(filter).select('+emailVerificationPurpose +pendingEmail');
  if (!user || !['verify', 'recover', 'email-change'].includes(user.emailVerificationPurpose || '')) throw new Error('This link is invalid or expired. Request a new link');
  const recoveredAccount = isAccountRecoverable(user);
  if (!isAccountActive(user) && !(recoveredAccount && user.emailVerificationPurpose === 'recover')) throw new Error('This link is invalid or expired. Request a new link');
  const password = await hashPassword(newPassword);
  const changingEmail = user.emailVerificationPurpose === 'email-change';
  const email = changingEmail ? validEmail(user.pendingEmail) : user.email;
  if (!email) throw new Error('Invalid email change');
  // Recheck status and the original deadline after hashing, so purge/deactivation wins a race.
  const eligibility = recoveredAccount
    ? {accountStatus: 'deactivated', purgeAfter: user.purgeAfter, $and: [{purgeAfter: {$gt: new Date()}}]}
    : isAccountActiveFilter();
  const updated = await User.findOneAndUpdate({...filter, emailVerificationExpiresAt: {$gt: new Date()}, _id: user._id, emailVerificationPurpose: user.emailVerificationPurpose, ...eligibility}, {
    $set: {password, emailVerifiedAt: new Date(), ...(changingEmail ? {email} : {}), ...(recoveredAccount ? {accountStatus: 'active', userFamilyID: ''} : {})},
    $inc: {sessionVersion: 1},
    $unset: {emailVerificationTokenHash: '', emailVerificationExpiresAt: '', emailVerificationPurpose: '', pendingEmail: '',
      resetPasswordToken: '', resetPasswordExpires: '', ...(changingEmail ? {googleProviderId: ''} : {}),
      ...(recoveredAccount ? {deactivatedAt: '', purgeAfter: ''} : {})},
  }, {new: true, runValidators: true});
  if (!updated) throw new Error('This link has already been used');
  if (changingEmail) {
    await Family.updateMany({'familyMembers.familyMemberID': String(updated._id)},
      {$set: {'familyMembers.$[member].familyMemberEmail': email}}, {arrayFilters: [{'member.familyMemberID': String(updated._id)}]});
  }
  return {email, recoveredAccount};
}
