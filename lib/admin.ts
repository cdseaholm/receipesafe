import { normalizeEmail } from './data-normalization';
export const normalizeAdminEmail = normalizeEmail;
export function getAppAdminEmail() { return normalizeEmail(process.env.ADMIN_USERNAME); }
export const getInquiryAdminEmail = getAppAdminEmail;
export function isAppAdmin(user: { _id: unknown; emailVerifiedAt?: unknown } | null | undefined) {
  const configuredId = process.env.ADMIN_USER_ID?.trim();
  return Boolean(configuredId && /^[a-f0-9]{24}$/i.test(configuredId) && user?.emailVerifiedAt && String(user._id) === configuredId);
}
export const isInquiryAdmin = isAppAdmin;
