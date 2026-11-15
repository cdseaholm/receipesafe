import { NextRequest, NextResponse } from 'next/server';
import Inquiry from '@/models/inquiry';
import { getCurrentUser } from '@/lib/auth/current-user';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { isSameOriginJSON } from '@/lib/security/request';

const types = ['General', 'Bug Report', 'Feature Request', 'Suggestion', 'Other'];
export async function POST(request: NextRequest) {
    const response = (status: number, message: string) => NextResponse.json({ status, message }, { status });
    if (!isSameOriginJSON(request)) return response(403, 'Use a same-origin JSON request');
    const user = await getCurrentUser();
    if (!user) return response(401, 'Unauthorized');
    if (!(await consumeRateLimit(`inquiry-create:${user._id}`, { limit: 10, windowMs: 3600_000 })).allowed) return response(429, 'Please wait before submitting another message');
    try {
        const { inquiryPassed: input } = await request.json();
        if (!input || !types.includes(input.inquiryType) || typeof input.inquiryMessage !== 'string' || !input.inquiryMessage.trim() || input.inquiryMessage.length > 5000
            || (input.inquiryTitle != null && typeof input.inquiryTitle !== 'string')) return response(400, 'Choose an inquiry type and a message of at most 5,000 characters');
        const returnedInquiry = await Inquiry.create({ inquirerUserID: String(user._id), inquirerName: user.name, inquirerEmail: user.email,
            inquiryType: input.inquiryType, inquiryMessage: input.inquiryMessage.trim(), inquiryTitle: input.inquiryTitle?.trim().slice(0, 120) || input.inquiryType,
            adminNote: '', read: false, handled: false });
        return NextResponse.json({ status: 200, message: 'Message submitted', returnedInquiry });
    } catch { return response(500, 'Unable to submit message'); }
}
