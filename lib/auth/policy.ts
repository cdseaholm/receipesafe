export function validEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function validNewPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && new TextEncoder().encode(value).length <= 72;
}

export function safeStoredPasswordHash(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(value)) return false;
  const rounds = Number(value.slice(4, 6));
  return rounds >= 4 && rounds <= 12;
}

export function isAccountActive(user: { accountStatus?: unknown } | null | undefined) {
  return Boolean(user && (user.accountStatus === undefined || user.accountStatus === 'active'));
}

export function isAccountRecoverable(user: { accountStatus?: unknown; purgeAfter?: unknown } | null | undefined, now = Date.now()) {
  if (!user || user.accountStatus !== 'deactivated') return false;
  const deadline = user.purgeAfter instanceof Date ? user.purgeAfter.getTime()
    : typeof user.purgeAfter === 'string' ? new Date(user.purgeAfter).getTime() : NaN;
  return Number.isFinite(deadline) && now < deadline;
}

export function isAccountActiveFilter() {
  return { $or: [{ accountStatus: 'active' }, { accountStatus: { $exists: false } }] };
}

export function matchesSession(user: { _id: unknown; sessionVersion?: number; emailVerifiedAt?: unknown; accountStatus?: unknown } | null,
  token: { id?: unknown; sessionVersion?: unknown }) {
  return Boolean(isAccountActive(user) && user?.emailVerifiedAt && typeof token.id === 'string' && String(user._id) === token.id &&
    typeof token.sessionVersion === 'number' && token.sessionVersion === (user.sessionVersion ?? 0));
}

export function profileUpdate(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid profile');
  const data = input as Record<string, unknown>;
  const allowed = new Set(['name', 'bio', 'profileImage']);
  if (Object.keys(data).some(key => !allowed.has(key))) throw new Error('Only name, bio and profile image can be updated here');
  const update: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || value.length > (key === 'bio' ? 2000 : key === 'name' ? 100 : 2048)) throw new Error('Invalid profile field');
    if (key === 'name' && !value.trim()) throw new Error('Name is required');
    if (key === 'profileImage' && value && !/^https:\/\//i.test(value)) throw new Error('Profile images must use HTTPS');
    update[key] = key === 'name' ? value.trim() : value;
  }
  if (!Object.keys(update).length) throw new Error('No profile fields supplied');
  return update;
}
