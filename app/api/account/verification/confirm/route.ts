import { accountJSON } from '@/lib/auth/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { confirmVerification } from '@/lib/auth/verification';
import { consumeRateLimit, requestIp } from '@/lib/security/rate-limit';
import { isSameOriginJSON } from '@/lib/security/request';

export async function POST(req: NextRequest) {
  if (!isSameOriginJSON(req)) return NextResponse.json({message: 'Invalid request origin'}, {status: 403});
  const limit = await consumeRateLimit(`verification:confirm:${requestIp(req.headers)}`, {limit: 20, windowMs: 15 * 60_000});
  if (!limit.allowed) return NextResponse.json({message: 'Please wait before trying again'}, {status: 429});
  try {
    const body = await accountJSON(req);
    const result = await confirmVerification(body.token, body.password);
    return NextResponse.json({message: result.recoveredAccount
      ? 'Account recovered. Sign in with your new password. Family membership is not automatically restored.'
      : 'Email verified. Sign in with your new password.', ...result});
  } catch (error) {
    const duplicate = (error as {code?: number}).code === 11000;
    return NextResponse.json({message: duplicate ? 'That email is already in use. Your original address is unchanged.' : 'Link invalid, expired or used. Request a new link and use a password of 12 characters or more (maximum 72 UTF-8 bytes).'}, {status: 400});
  }
}

