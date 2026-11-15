import type { IFamily } from '@/models/types/family/family';
import type { IFamilyMember } from '@/models/types/family/familyMember';
import { normalizeId } from '@/lib/data-normalization';

export const FAMILY_ROLES = ['Guest', 'Member', 'Admin'] as const;
export function connectedFamilyMember(family: Pick<IFamily, 'familyMembers'>, userId: unknown) {
    const id = normalizeId(userId);
    return id ? family.familyMembers?.find(member => member.memberConnected && normalizeId(member.familyMemberID) === id) || null : null;
}
export function hasConnectedAdmin(members: IFamilyMember[]) {
    return members.some(member => member.memberConnected && member.permissionStatus === 'Admin' && Boolean(normalizeId(member.familyMemberID)));
}
export function familyMemberKey(member: IFamilyMember) {
    return normalizeId(member.familyMemberID) || member.familyMemberEmail?.trim().toLowerCase() || '';
}
export function canDeleteFamily(family: Pick<IFamily, 'familyMembers'>, userId: unknown) {
    const member = connectedFamilyMember(family, userId);
    return member?.permissionStatus === 'Admin';
}
