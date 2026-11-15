import { serializeCommunityForClient, getAuthedUser } from '@/lib/community-utils';
import { COMMUNITIES_ENABLED } from '@/lib/features';
import { communityUnavailableResponse } from '@/lib/community-utils';
import { NextResponse } from "next/server";
import Community from "@/models/community";
import { ICommunity } from "@/models/types/community/community";
import { canDiscoverCommunity, normalizeCommunityId } from "@/lib/community-utils";

export async function GET(req: Request) {
    if (!COMMUNITIES_ENABLED) return communityUnavailableResponse();
    const { error, user } = await getAuthedUser(req);
    if (error || !user) return error || NextResponse.json({ status: 401, message: 'Unauthorized' }, { status: 401 });

    try {
        const communities = await Community.find({}).lean() as ICommunity[];

        if (!communities || communities.length === 0) {
            return NextResponse.json({ status: 404, message: 'No communities found', communities: [] as ICommunity[] })
        }

        const userId = normalizeCommunityId(user._id);
        const search = new URL(req.url).searchParams.get('search');
        const viewableCommunities = communities.filter(community => canDiscoverCommunity(community, userId, search));

        return NextResponse.json({ status: 200, message: 'Success!', communities: viewableCommunities.map(serializeCommunityForClient) });
    } catch (error) {

        return NextResponse.json({ status: 500, message: 'Internal Server Error', communities: [] as ICommunity[] });
    }
}
