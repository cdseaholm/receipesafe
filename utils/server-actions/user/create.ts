'use server';
import { headers } from 'next/headers';
import { registerAccount, verificationMessage } from '@/lib/auth/verification';
import { consumeRateLimit, requestIp } from '@/lib/security/rate-limit';
export async function CreateUser({name, email, password}: {name: string; email: string; password: string; route?: string}) {
  try {
    const limit = await consumeRateLimit(`register:ip:${requestIp(await headers())}`, {limit: 10, windowMs: 60 * 60_000});
    if (!limit.allowed) return {status: false, message: 'Please wait before registering again', newUser: null};
    await registerAccount({name, email, password});
    return {status: true, message: verificationMessage, verificationRequired: true, newUser: null};
  } catch (error) {
    return {status: false, message: error instanceof Error ? error.message : 'Unable to register', newUser: null};
  }
}
