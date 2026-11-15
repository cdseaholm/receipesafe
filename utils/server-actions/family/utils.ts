import connectDB from "@/lib/mongodb";
import Family from "@/models/family";
import { IFamily } from "@/models/types/family/family";
import { IFamilyMember } from "@/models/types/family/familyMember";
import { IUser } from "@/models/types/personal/user";
import { Types } from "mongoose";
import { getCurrentUser } from '@/lib/auth/current-user';
import { verifyCurrentPassword } from '@/lib/auth/password';
import { connectedFamilyMember } from '@/lib/family-policy';
import { normalizeEmail as normalizeSharedEmail, normalizeId as normalizeSharedId } from "@/lib/data-normalization";

export type FamilyActionResult<T = unknown> = {
    success: boolean;
    message: string;
} & T;

export function isValidId(id: string) {
    return Types.ObjectId.isValid(id);
}

export function getRevalidationPath(route: string, fallback = "/") {
    return route?.startsWith("/") ? route : fallback;
}

export function normalizeEmail(email: string) {
    return normalizeSharedEmail(email);
}

export function normalizeId(id: unknown) {
    return normalizeSharedId(id);
}

export function getFamilyMember(family: IFamily, user: IUser) {
    return connectedFamilyMember(family, user._id);
}

export function hasAdminPrivilege(member: IFamilyMember | null) {
    return member?.permissionStatus === "Admin";
}

export function hasConnectedMembership(member: IFamilyMember | null, user: IUser) {
    if (!member?.memberConnected) return false;

    return normalizeId(member.familyMemberID) === normalizeId(user._id);
}

export async function getAuthenticatedFamilyContext(familyId: string) {
    const userDoc = await getCurrentUser();
    if (!userDoc) {
        return { user: null, family: null, member: null, message: "Unauthorized" };
    }

    if (!familyId || !isValidId(familyId)) {
        return { user: null, family: null, member: null, message: "Invalid family ID" };
    }

    const famIdString = normalizeId(familyId);

    await connectDB();

    const familyDoc = await Family.findOne({ _id: famIdString, deletedAt: null });
    if (!familyDoc) {
        return { user: userDoc as IUser, family: null, member: null, message: "Family not found" };
    }

    if (normalizeId((userDoc as IUser).userFamilyID) !== famIdString) {
        return { user: userDoc as IUser, family: null, member: null, message: "You do not belong to this family" };
    }

    const member = getFamilyMember(familyDoc as IFamily, userDoc as IUser);
    if (!hasConnectedMembership(member, userDoc as IUser)) {
        return { user: userDoc as IUser, family: null, member: null, message: "You do not belong to this family" };
    }

    return { user: userDoc, family: familyDoc, member, message: "" };
}

export async function verifyUserPassword(user: IUser, password: string | undefined) {
    if (!password) return false;
    return verifyCurrentPassword(normalizeId(user._id), password);
}

export function sanitizeFamilyMember(member: IFamilyMember): IFamilyMember {
    return {
        familyMemberID: member.familyMemberID,
        familyMemberName: member.familyMemberName,
        familyMemberEmail: normalizeEmail(member.familyMemberEmail),
        permissionStatus: member.permissionStatus,
        memberConnected: Boolean(member.memberConnected),
    };
}
