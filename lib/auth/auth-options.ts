import { getServerSession, type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import User from '@/models/user';
import connectDB from '@/lib/mongodb';
import { verifyPassword } from './password';
import { isAccountActive, matchesSession, validEmail } from './policy';
import { consumeRateLimit, requestIp } from '@/lib/security/rate-limit';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' }),
    CredentialsProvider({
      credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' } },
      async authorize(credentials, req) {
        const email = validEmail(credentials?.email);
        const password = credentials?.password;
        if (!email || typeof password !== 'string' || password.length > 256) return null;
        const ip = requestIp({get: name => { const value = req.headers?.[name]; return Array.isArray(value) ? value[0] : value || null; }});
        const limits = await Promise.all([
          consumeRateLimit(`login:email:${email}`, {limit: 10, windowMs: 15 * 60_000}),
          consumeRateLimit(`login:ip:${ip}`, {limit: 40, windowMs: 15 * 60_000}),
        ]);
        if (limits.some(limit => !limit.allowed)) return null;
        await connectDB();
        const user = await User.findOne({email}).select('+password +sessionVersion');
        if (!isAccountActive(user) || !user?.emailVerifiedAt || !await verifyPassword(password, user.password)) return null;
        return {id: String(user._id), email: user.email, name: user.name, sessionVersion: user.sessionVersion ?? 0, emailVerified: true};
      },
    }),
  ],
  session: {strategy: 'jwt', maxAge: 7 * 24 * 60 * 60},
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {sessionToken: {
    name: `${process.env.NODE_ENV === 'production' ? '__Secure-' : ''}recipesafe.session-token`,
    options: {httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production'},
  }},
  pages: {signIn: '/login', error: '/login'},
  callbacks: {
    async signIn({account, profile, user}) {
      if (account?.provider !== 'google') return true;
      const email = validEmail(profile?.email);
      if (!email || (profile as {email_verified?: boolean})?.email_verified !== true || !account.providerAccountId) return false;
      await connectDB();
      let appUser = await User.findOne({email}).select('+sessionVersion +googleProviderId');
      if (appUser) {
        // Only the emailed recovery flow may reactivate an account during its closure window.
        if (!isAccountActive(appUser)) return false;
        if (appUser.googleProviderId && appUser.googleProviderId !== account.providerAccountId) return false;
        if (appUser.emailVerifiedAt && !appUser.googleProviderId) {
          // Linking an existing verified local account requires its current authenticated session.
          const session = await getServerSession(authOptions);
          if (!matchesSession(appUser, {id: session?.user?.id, sessionVersion: session?.user?.sessionVersion})) return false;
        }
        if (!appUser.emailVerifiedAt) {
          // A mailbox owner claiming an old unverified registration must evict its creator.
          appUser.password = '';
          appUser.sessionVersion = (appUser.sessionVersion ?? 0) + 1;
        }
        appUser.emailVerifiedAt = new Date();
        appUser.googleProviderId = account.providerAccountId;
        appUser.emailVerificationTokenHash = undefined;
        appUser.emailVerificationExpiresAt = undefined;
        appUser.emailVerificationPurpose = undefined;
        appUser.pendingEmail = undefined;
        await appUser.save();
      } else {
        appUser = await User.create({name: user.name?.slice(0, 100) || email.split('@')[0], email, password: '',
          emailVerifiedAt: new Date(), googleProviderId: account.providerAccountId, sessionVersion: 0, profileImage: user.image || ''});
      }
      user.id = String(appUser._id);
      user.email = appUser.email;
      user.name = appUser.name;
      user.sessionVersion = appUser.sessionVersion ?? 0;
      user.emailVerified = true;
      return true;
    },
    async jwt({token, user}) {
      if (user) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion;
      }
      if (!token.id || !/^[a-f\d]{24}$/i.test(token.id) || typeof token.sessionVersion !== 'number') throw new Error('Session expired; sign in again');
      await connectDB();
      const current = await User.findById(token.id).select('+sessionVersion');
      if (!matchesSession(current, token)) throw new Error('Session expired; sign in again');
      token.email = current!.email;
      token.name = current!.name;
      token.emailVerified = true;
      return token;
    },
    async session({session, token}) {
      session.user = {id: token.id, sessionVersion: token.sessionVersion, emailVerified: token.emailVerified,
        email: token.email, name: token.name};
      return session;
    },
  },
};
