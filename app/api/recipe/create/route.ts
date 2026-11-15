import { isSameOriginJSON } from '@/lib/security/request';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { createRecipeForUser } from '@/lib/recipe-mutations';
import Family from '@/models/family';
import Community from '@/models/community';
import Ingredient from '@/models/ingredient';
import { getFamilyMember, hasConnectedMembership } from '@/utils/server-actions/family/utils';
import { isCommunityMember } from '@/lib/community-utils';
import { COMMUNITIES_ENABLED } from '@/lib/features';
import { revalidatePath } from 'next/cache';
import { Types } from 'mongoose';
import { CreateRecipe } from '@/utils/server-actions/recipe/create';
import Recipe from '@/models/recipe';
export async function POST(req: NextRequest) {
    if (!isSameOriginJSON(req)) return NextResponse.json({ status: 403, message: 'Invalid request origin' }, { status: 403 });
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ status: 401, message: 'Unauthorized', recipeReturned: null, returnedIngredients: [] }, { status: 401 });
    try {
        const raw = await req.text();
        if (raw.length > 524288) return NextResponse.json({ status: 413, message: 'Request too large' }, { status: 413 });
        const body = JSON.parse(raw);
        const type = body.type || 'personal';
        const typeId = body.typeId;
        if (!['personal', 'family', 'community', 'post'].includes(type)) throw new Error('Invalid destination');
        if ((type === 'community' || type === 'post') && !COMMUNITIES_ENABLED) return NextResponse.json({ status: 404, message: 'Not found' }, { status: 404 });
        if (type === 'family') {
            if (typeof typeId !== 'string' || !Types.ObjectId.isValid(typeId) || typeId !== user.userFamilyID) throw new Error('Invalid family');
            const family = await Family.findOne({ _id: typeId, deletedAt: null });
            if (!family || !hasConnectedMembership(getFamilyMember(family, user), user)) throw new Error('Join the family first');
        }
        if (type === 'community') {
            if (typeof typeId !== 'string' || !Types.ObjectId.isValid(typeId) || body.recipePassed?.secret === true) throw new Error('Invalid community recipe');
            const community = await Community.findById(typeId);
            if (!community || !isCommunityMember(community, String(user._id))) throw new Error('Join the community first');
        }
        let recipeReturned;
        if (type === 'family') {
            const result = await CreateRecipe(body.recipePassed, '/u/recipes', typeId);
            if (!result.success || !result.recipeId) return NextResponse.json({ status: 400, message: result.message, recipeReturned: null, returnedIngredients: [] }, { status: 400 });
            recipeReturned = await Recipe.findOne({ _id: result.recipeId, creatorID: String(user._id) });
        } else {
            recipeReturned = await createRecipeForUser(user, body.recipePassed);
        }
        if (!recipeReturned) throw new Error('Recipe not found');
        if (type === 'community') await Community.updateOne({ _id: typeId }, { $addToSet: { recipeIDs: String(recipeReturned._id) } });
        const returnedIngredients = await Ingredient.find({}).lean();
        revalidatePath('/u/recipes');
        return NextResponse.json({ status: 200, message: 'Recipe created', recipeReturned, returnedIngredients });
    } catch {
        return NextResponse.json({ status: 400, message: 'Recipe creation rejected', recipeReturned: null, returnedIngredients: [] }, { status: 400 });
    }
}
