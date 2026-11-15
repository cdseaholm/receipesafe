import { NextRequest, NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import Inquiry from '@/models/inquiry';
import { getCurrentUser } from '@/lib/auth/current-user';
import { inquiryAccessFilter } from '@/lib/inquiry-access';
import { isInquiryAdmin } from '@/lib/admin';
import { isSameOriginJSON } from '@/lib/security/request';

export async function PUT(request: NextRequest) {
    const response = (status: number, message: string) => NextResponse.json({ status, message, inquiriesReturned: null }, { status });
    if (!isSameOriginJSON(request)) return response(403, 'Use a same-origin JSON request');
    const user = await getCurrentUser();
    if (!user) return response(401, 'Unauthorized');
    try {
        const { inquiriesToEdit: items } = await request.json();
        if (!Array.isArray(items) || !items.length || items.length > 50 || items.some(item => !isValidObjectId(item?._id))) return response(400, 'Select valid messages');
        for (const item of items) {
            const update: Record<string, unknown> = { read: Boolean(item.read), updatedAt: new Date() };
            if (isInquiryAdmin(user)) { update.handled = Boolean(item.handled); update.adminNote = typeof item.adminNote === 'string' ? item.adminNote.slice(0, 5000) : ''; }
            await Inquiry.updateOne({ _id: item._id, ...inquiryAccessFilter(user) }, { $set: update }, { runValidators: true });
        }
        const inquiriesReturned = await Inquiry.find(inquiryAccessFilter(user)).sort({ createdAt: -1 }).limit(100).lean();
        return NextResponse.json({ status: 200, message: 'Messages updated', inquiriesReturned });
    } catch { return response(500, 'Unable to update messages'); }
}
