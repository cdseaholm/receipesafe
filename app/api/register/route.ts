import { accountJSON } from '@/lib/auth/request-body';
import { NextRequest, NextResponse } from 'next/server';
import { registerAccount, verificationMessage } from '@/lib/auth/verification';
import { consumeRateLimit, requestIp } from '@/lib/security/rate-limit';
import { isSameOriginJSON } from '@/lib/security/request';
export async function POST(req: NextRequest) {
  if (!isSameOriginJSON(req)) return NextResponse.json({status: 403, message: 'Invalid request origin'}, {status: 403});
  const limit = await consumeRateLimit(`register:ip:${requestIp(req.headers)}`, {limit: 10, windowMs: 60 * 60_000});
  if (!limit.allowed) return NextResponse.json({status: 429, message: 'Please wait before registering again'}, {status: 429});
  try {
    const body = await accountJSON(req);
    if ('saltedPW' in body || 'passwordHash' in body) return NextResponse.json({status: 400, message: 'Supply a password, not a password hash'}, {status: 400});
    await registerAccount({name: body.namePassed ?? body.name, email: body.emailPassed ?? body.email,
      password: body.password, inviteToken: (body.invite as {token?: unknown} | null)?.token});
    return NextResponse.json({status: 200, message: verificationMessage, verificationRequired: true, newUser: null});
  } catch (error) {
    return NextResponse.json({status: 400, message: error instanceof Error ? error.message : 'Unable to register'}, {status: 400});
  }
}
