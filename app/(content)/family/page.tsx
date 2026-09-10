import { Metadata } from "next";
import { redirect } from "next/navigation";
import connectDB from "@/lib/mongodb";
import Family from "@/models/family";
import Invite from "@/models/invite";
import { getSessionUser } from "@/lib/data/user";
import { createPageMetadata } from "@/lib/metadata";
import { IFamily } from "@/models/types/family/family";
import { IInvite } from "@/models/types/misc/invite";
import { isInviteExpired, normalizeInviteEmail } from "@/lib/invite-utils";
import { serializeDoc } from "@/utils/data/seralize";
import FamilyStartPage, { FamilyStartInvite } from "./components/family-start-page";

export async function generateMetadata(): Promise<Metadata> {
    return createPageMetadata({
        title: "Family",
        description: "Create a RecipeSafe family space or accept pending family invitations.",
        robots: { index: false, follow: true },
    });
}

export default async function Page() {
    const user = await getSessionUser();

    if (!user) {
        redirect("/");
    }

    if (user.userFamilyID) {
        redirect(`/family/${user.userFamilyID}`);
    }

    await connectDB();

    const invitesDoc = await Invite
        .find({ email: normalizeInviteEmail(user.email), inviteType: { $in: ['family', null] } })
        .sort({ createdAt: -1 })
        .lean();
    const activeInvites = invitesDoc
        .map(doc => serializeDoc<IInvite>(doc))
        .filter(invite => !isInviteExpired(invite));
    const inviteFamilyIds = Array.from(new Set(activeInvites.map(invite => invite.familyID).filter(Boolean)));
    const inviteFamiliesDoc = inviteFamilyIds.length > 0
        ? await Family.find({ _id: { $in: inviteFamilyIds } }).select('name').lean()
        : [];
    const inviteFamilyNames = new Map(
        inviteFamiliesDoc
            .map(doc => serializeDoc<Pick<IFamily, '_id' | 'name'>>(doc))
            .map(family => [family._id.toString(), family.name])
    );
    const familyInvites = activeInvites.map(invite => ({
        ...invite,
        familyName: inviteFamilyNames.get(invite.familyID) || 'Family',
    })) as FamilyStartInvite[];

    return <FamilyStartPage user={user} familyInvites={familyInvites} />;
}
