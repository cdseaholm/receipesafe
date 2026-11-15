import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getRecipesVisibleToUser } from '@/lib/data/recipes';
export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ status: 401, message: 'Unauthorized', recipes: [] }, { status: 401 });
    const recipes = await getRecipesVisibleToUser(user.recipeIDs || [], user);
    return NextResponse.json({ status: 200, message: 'Success!', recipes });
}
