import { COMMUNITIES_ENABLED } from '@/lib/features';
import { communityUnavailableResponse, getAuthedUser } from '@/lib/community-utils';
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { IPost } from "@/models/types/misc/post";
import Community from "@/models/community";
import Post from "@/models/post";

export async function GET(req: NextRequest) {
    if (!COMMUNITIES_ENABLED) return communityUnavailableResponse();
    const { error, user } = await getAuthedUser(req);
    if (error || !user) return error || NextResponse.json({ status: 401, message: 'Unauthorized' }, { status: 401 });

    try {
        const body = await req.json();
        const communityID = body.communityID as string;

        if (!communityID) {
            return NextResponse.json({ status: 400, message: 'No community ID provided', postReturned: [] as IPost[] });
        }

        if (!user.communityIDs.map(id => id.toString()).includes(communityID)) {
            return NextResponse.json({ status: 403, message: 'You need access to this community to post', postReturned: [] as IPost[] });
        }

        const communityPosts = await Community.findById(new ObjectId(communityID)).select('postIDs').lean() as string[] | null;

        if (!communityPosts) {
            return NextResponse.json({ status: 404, message: 'Community posts not found', postReturned: [] as IPost[] });
        }

        const posts = await Post.find({ _id: { $in: communityPosts.map(id => new ObjectId(id)) } }).lean() as IPost[] | [] as IPost[];

        return NextResponse.json({ status: 200, message: 'Success!', postReturned: posts as IPost[] });

    } catch (error) {
        return NextResponse.json({ status: 500, message: 'Internal Server Error', postReturned: [] as IPost[] });
    }
}
