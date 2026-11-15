import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { toCurrentUserDTO } from '@/lib/security/user-dto';
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({status: 401, message: 'Unauthorized'}, {status: 401});
  return NextResponse.json({status: 200, message: 'Success!', userInfo: toCurrentUserDTO(user)}, {headers: {'Cache-Control': 'private, no-store'}});
}
