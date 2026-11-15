import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/current-user';
import { accountJSON } from '@/lib/auth/request-body';
import { isSameOriginJSON } from '@/lib/security/request';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { listRecipeTransfers, offerRecipeTransfer, respondRecipeTransfer, RecipeTransferError } from '@/lib/recipe-transfers';

export const dynamic = 'force-dynamic';
function failure(error: unknown) {
    const status = error instanceof RecipeTransferError ? error.status : 400;
    return NextResponse.json({ status, message: error instanceof RecipeTransferError ? error.message : 'Unable to update recipe transfers. Please retry.' }, { status });
}
export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ status: 401, message: 'Unauthorized' }, { status: 401 });
    if (!(await consumeRateLimit(`recipe:transfers:list:${user._id}`, { limit: 60, windowMs: 60_000 })).allowed) return NextResponse.json({ status: 429, message: 'Please wait before loading transfers again.' }, { status: 429 });
    try { return NextResponse.json({ status: 200, ...await listRecipeTransfers(user) }, { headers: { 'Cache-Control': 'private, no-store' } }); }
    catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
    if (!isSameOriginJSON(req)) return NextResponse.json({ status: 403, message: 'Invalid request origin' }, { status: 403 });
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ status: 401, message: 'Unauthorized' }, { status: 401 });
    try {
        const body = await accountJSON(req);
        if (body.action === 'offer') {
            const result = await offerRecipeTransfer(user, { recipeID: body.recipeID, toUserID: body.toUserID, password: body.password });
            return NextResponse.json({ status: 200, message: 'Offer sent. Ownership changes only when the selected family admin accepts.', ...result });
        }
        if (body.action !== 'accept' && body.action !== 'decline' && body.action !== 'cancel') throw new RecipeTransferError('Invalid transfer action.');
        const result = await respondRecipeTransfer(user, { transferID: body.transferID, action: body.action });
        revalidatePath('/u');
        revalidatePath('/family');
        return NextResponse.json({ status: 200, message: body.action === 'accept' ? 'Recipe ownership transferred to you.' : 'Recipe transfer updated.', transferStatus: result?.status });
    } catch (error) { return failure(error); }
}
