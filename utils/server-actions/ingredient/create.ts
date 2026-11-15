'use server'
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/current-user';
import Ingredient from '@/models/ingredient';
import type { IngredientForForm } from '@/models/types/recipes/ingredient';
export async function CreateIngredient(ingName: IngredientForForm, path: string) {
    const user = await getCurrentUser();
    if (!user) return { success: false, message: 'Unauthorized', ingredientId: null };
    const name = ingName?.ingredient;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) return { success: false, message: 'Enter an ingredient name (up to 200 characters)', ingredientId: null };
    try {
        const ingredient = await Ingredient.findOne({ ingredient: name.trim() }) || await Ingredient.create({ ingredient: name.trim() });
        revalidatePath(typeof path === 'string' && path.startsWith('/') ? path : '/u/recipes');
        return { success: true, message: 'Ingredient ready', ingredientId: String(ingredient._id) };
    } catch { return { success: false, message: 'Failed to create ingredient', ingredientId: null }; }
}
