import { accountJSON } from '@/lib/auth/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { requestVerification, verificationMessage } from '@/lib/auth/verification';
import { consumeRateLimit, requestIp } from '@/lib/security/rate-limit';
import { isSameOriginJSON } from '@/lib/security/request';

export async function POST(req: NextRequest) {
  if (!isSameOriginJSON(req)) return NextResponse.json({message: 'Invalid request origin'}, {status: 403});
  const limit = await consumeRateLimit(`verification:ip:${requestIp(req.headers)}`, {limit: 10, windowMs: 60 * 60_000});
  if (!limit.allowed) return NextResponse.json({message: 'Please wait before requesting another email'}, {status: 429, headers: {'Retry-After': String(limit.retryAfter)}});
  try {
    await requestVerification((await accountJSON(req, 4096)).email);
    return NextResponse.json({message: verificationMessage});
  } catch {
    return NextResponse.json({message: 'Unable to send verification email. Check the address or try again later'}, {status: 400});
  }
}

