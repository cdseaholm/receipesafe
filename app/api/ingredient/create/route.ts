import { isSameOriginJSON } from '@/lib/security/request';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import Ingredient from '@/models/ingredient';
export async function POST(req: NextRequest) {
    if (!isSameOriginJSON(req)) return NextResponse.json({ status: 403, message: 'Invalid request origin' }, { status: 403 });
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ status: 401, message: 'Unauthorized', ingredientsReturned: [] }, { status: 401 });
    try {
        const raw = await req.text();
        if (raw.length > 524288) return NextResponse.json({ status: 413, message: 'Request too large' }, { status: 413 });
        const body = JSON.parse(raw);
        const ingredients = body.newIngredients;
        if (!Array.isArray(ingredients) || !ingredients.length || ingredients.length > 100 || ingredients.some(ing => typeof ing?.ingredient !== 'string' || !ing.ingredient.trim() || ing.ingredient.length > 200)) throw new Error('Invalid ingredients');
        const ingredientsReturned = [];
        for (const ing of ingredients) {
            const name = ing.ingredient.trim();
            ingredientsReturned.push(await Ingredient.findOne({ ingredient: name }) || await Ingredient.create({ ingredient: name }));
        }
        return NextResponse.json({ status: 200, message: 'Ingredients ready', ingredientsReturned });
    } catch { return NextResponse.json({ status: 400, message: 'Invalid ingredients', ingredientsReturned: [] }, { status: 400 }); }
}
