import { NextRequest, NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import Inquiry from '@/models/inquiry';
import { getCurrentUser } from '@/lib/auth/current-user';
import { inquiryAccessFilter } from '@/lib/inquiry-access';
import { isSameOriginJSON } from '@/lib/security/request';

export async function DELETE(request: NextRequest) {
    const response = (status: number, message: string) => NextResponse.json({ status, message }, { status });
    if (!isSameOriginJSON(request)) return response(403, 'Use a same-origin JSON request');
    const user = await getCurrentUser();
    if (!user) return response(401, 'Unauthorized');
    try {
        const { itemsToDelete: items } = await request.json();
        if (!Array.isArray(items) || !items.length || items.length > 50 || items.some(item => !isValidObjectId(item?._id))) return response(400, 'Select valid messages');
        await Inquiry.deleteMany({ _id: { $in: items.map(item => item._id) }, ...inquiryAccessFilter(user) });
        return response(200, 'Messages deleted');
    } catch { return response(500, 'Unable to delete messages'); }
}
