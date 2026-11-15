import { NextResponse } from 'next/server';
import Inquiry from '@/models/inquiry';
import { getCurrentUser } from '@/lib/auth/current-user';
import { inquiryAccessFilter } from '@/lib/inquiry-access';

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ status: 401, message: 'Unauthorized', inquirys: [] }, { status: 401 });
    try {
        const inquirys = await Inquiry.find(inquiryAccessFilter(user)).sort({ createdAt: -1 }).limit(100).lean();
        return NextResponse.json({ status: 200, message: 'Success', inquirys });
    } catch { return NextResponse.json({ status: 500, message: 'Unable to load messages', inquirys: [] }, { status: 500 }); }
}
