import { NextResponse } from 'next/server';

// The legacy test route must never create invitations, in any environment.
export async function POST() {
    return NextResponse.json({ status: 404, message: 'Not found' }, { status: 404 });
}
