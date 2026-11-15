export type IInvite = {
    email: string;
    inviteType?: 'family' | 'community';
    invitedByUserID?: string;
    permissionStatus?: 'Guest' | 'Member' | 'Admin';
    familyID: string;
    communityID?: string;
    token: string;
    read?: boolean;
    createdAt: Date;
}
