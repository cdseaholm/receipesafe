import type { DefaultSession } from 'next-auth';
declare module 'next-auth' {
  interface Session { user: DefaultSession['user'] & { id?: string; sessionVersion?: number; emailVerified?: boolean }; }
  interface User { sessionVersion?: number; emailVerified?: boolean; }
}
declare module 'next-auth/jwt' {
  interface JWT { id?: string; sessionVersion?: number; emailVerified?: boolean; }
}
