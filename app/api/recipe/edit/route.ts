import { isSameOriginJSON } from '@/lib/security/request';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { updateRecipeForUser } from '@/lib/recipe-mutations';
import { revalidatePath } from 'next/cache';
export async function PUT(req: NextRequest) {
    if (!isSameOriginJSON(req)) return NextResponse.json({ status: 403, message: 'Invalid request origin' }, { status: 403 });
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ status: 401, message: 'Unauthorized', recipeReturned: null }, { status: 401 });
    try {
        const raw = await req.text();
        if (raw.length > 524288) return NextResponse.json({ status: 413, message: 'Request too large' }, { status: 413 });
        const body = JSON.parse(raw);
        const id = body.recipeId || body.recipePassed?._id;
        const recipeReturned = await updateRecipeForUser(user, id, body.recipePassed);
        revalidatePath('/u/recipes');
        return NextResponse.json({ status: 200, message: 'Recipe updated', recipeReturned });
    } catch {
        return NextResponse.json({ status: 400, message: 'Recipe update rejected', recipeReturned: null }, { status: 400 });
    }
}
