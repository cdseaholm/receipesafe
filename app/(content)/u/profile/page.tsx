import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import connectDB from '@/lib/mongodb';
import Family from '@/models/family';
import Review from '@/models/review';
import Recipe from '@/models/recipe';
import Community from '@/models/community';
import Inquiry from '@/models/inquiry';
import Invite from '@/models/invite';
import type { IFamily } from '@/models/types/family/family';
import type { IReview } from '@/models/types/misc/review';
import type { IInquiry } from '@/models/types/misc/inquiry';
import type { IInvite } from '@/models/types/misc/invite';
import type { ICommunity } from '@/models/types/community/community';
import { serializeDoc } from '@/utils/data/seralize';
import { getSessionUser } from '@/lib/data/user';
import { getRecipesVisibleToUser } from '@/lib/data/recipes';
import { createPageMetadata } from '@/lib/metadata';
import { isInquiryAdmin } from '@/lib/admin';
import { COMMUNITIES_ENABLED } from '@/lib/features';
import { isCommunityMember, serializeCommunityForClient } from '@/lib/community-utils';
import { isInviteExpired, normalizeInviteEmail } from '@/lib/invite-utils';
import ProfilePage from '../components/profile-page';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
    return createPageMetadata({ title: 'My Dashboard', description: 'Your personal recipes, family, invitations, and account.', robots: { index: false, follow: false } });
}

export default async function Page() {
    const user = await getSessionUser();
    if (!user) redirect('/login');
    await connectDB();
    const userIsInquiryAdmin = isInquiryAdmin(user);
    const [family, reviewsDoc, ownRecipeDocs, favorites, inquiriesDoc, invitesDoc, communityDocs] = await Promise.all([
        user.userFamilyID ? Family.findOne({ _id: user.userFamilyID, deletedAt: null, familyMembers: { $elemMatch: { familyMemberID: user._id, memberConnected: true } } }).lean() : null,
        Review.find({ authorId: user._id }).limit(100).lean(),
        Recipe.find({ creatorID: user._id }).select('_id').sort({ createdAt: -1 }).lean(),
        getRecipesVisibleToUser(user.favoriteRecipeIDs || [], user),
        Inquiry.find(userIsInquiryAdmin ? {} : { inquirerUserID: user._id }).sort({ createdAt: -1 }).limit(100).lean(),
        Invite.find({ email: normalizeInviteEmail(user.email), ...(COMMUNITIES_ENABLED ? {} : { inviteType: 'family' }) }).sort({ createdAt: -1 }).limit(100).lean(),
        COMMUNITIES_ENABLED ? Community.find({ $or: [{ creatorID: user._id }, { communityMemberIDs: user._id }, { adminIDs: user._id }] }).lean() : [],
    ]);
    const recentIds = ownRecipeDocs.slice(0, 6).map(doc => String(doc._id));
    const recentRecipes = await getRecipesVisibleToUser(recentIds, user);
    const active = invitesDoc.map(doc => serializeDoc<IInvite>(doc)).filter(invite => !isInviteExpired(invite));
    const familyActive = active.filter(invite => (invite.inviteType || 'family') === 'family' && invite.invitedByUserID);
    const inviteFamilies = familyActive.length ? await Family.find({ _id: { $in: familyActive.map(invite => invite.familyID) }, deletedAt: null }).select('name').lean() : [];
    const names = new Map(inviteFamilies.map(doc => [String(doc._id), doc.name]));
    const familyInvites = familyActive.map(invite => ({ ...invite, familyName: names.get(invite.familyID) || 'Family' }));
    const communityInvites = COMMUNITIES_ENABLED ? active.filter(invite => invite.inviteType === 'community').map(invite => ({ ...invite, inviteType: 'community' as const, communityID: invite.communityID || '', communityName: 'Community' })) : [];
    const communities = communityDocs.map(doc => serializeCommunityForClient(serializeDoc<ICommunity>(doc))).filter(doc => isCommunityMember(doc, user._id));
    const safeUser = { ...user, userFamilyID: family ? user.userFamilyID : '', recipeIDs: ownRecipeDocs.map(doc => String(doc._id)), favoriteRecipeIDs: favorites.map(recipe => recipe._id) };
    return <ProfilePage user={safeUser} familyData={family ? serializeDoc<IFamily>(family) : null}
        reviews={reviewsDoc.map(doc => serializeDoc<IReview>(doc))} recentRecipes={recentRecipes} favoriteRecipes={favorites}
        inquiries={inquiriesDoc.map(doc => serializeDoc<IInquiry>(doc))} familyInvites={familyInvites} communityInvites={communityInvites}
        userIsInquiryAdmin={userIsInquiryAdmin} communitiesCreated={communities.filter(doc => doc.creatorID === user._id)} communitiesJoined={communities} />;
}
