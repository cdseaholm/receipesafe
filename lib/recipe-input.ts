import { Types } from 'mongoose';

function text(value: unknown, maximum: number, required = false) {
    if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new Error('Invalid recipe data');
    return value.trim();
}

export function validatedRecipeInput(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Recipe data is required');
    const v = value as Record<string, unknown>;
    const list = (input: unknown, maximum: number): unknown[] => {
        if (!Array.isArray(input) || input.length > maximum) throw new Error('Invalid recipe data');
        return input;
    };
    const ingredients = list(v.ingredients || [], 500).map(input => {
        if (!input || typeof input !== 'object') throw new Error('Invalid ingredient');
        const ing = input as Record<string, unknown>;
        const ingredientId = ing.ingredientId ? text(ing.ingredientId, 24) : '';
        if (ingredientId && !Types.ObjectId.isValid(ingredientId)) throw new Error('Invalid ingredient');
        return { ingredient: text(ing.ingredient, 200, true), quantity: text(ing.quantity || '', 200), ingredientId };
    });
    const steps = list(v.steps || [], 200).map(input => {
        if (!input || typeof input !== 'object') throw new Error('Invalid step');
        const step = input as Record<string, unknown>;
        return {
            stepId: Number.isSafeInteger(step.stepId) ? step.stepId as number : 0,
            stepType: text(step.stepType || '', 100), description: text(step.description || '', 10000),
            relatedRecipeID: text(step.relatedRecipeID || '', 24), image: text(step.image || '', 4096),
            ingredientIds: list(step.ingredientIds || [], 500).map(id => text(id, 100)),
            stepAlternate: list(step.stepAlternate || [], 100).map(item => text(item, 10000)),
        };
    });
    if (v.secret !== undefined && typeof v.secret !== 'boolean') throw new Error('Invalid recipe privacy');
    const secret = v.secret === true;
    const secretViewerIDs = secret ? list(v.secretViewerIDs || [], 200).map(id => text(id, 320, true)).map(id => id.includes('@') ? id.toLowerCase() : id) : [];
    if (secretViewerIDs.some(id => !Types.ObjectId.isValid(id) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id))) throw new Error('Invalid private recipe viewer');
    const cookingTime = Number(v.cookingTime || 0);
    if (!Number.isFinite(cookingTime) || cookingTime < 0 || cookingTime > 525600) throw new Error('Invalid cooking time');
    const recipeFor = list(v.recipeFor || ['personal'], 3).map(item => text(item, 20));
    if (recipeFor.some(item => !['personal', 'family', 'community'].includes(item))) throw new Error('Invalid recipe destination');
    return { name: text(v.name, 200, true), description: text(v.description || '', 10000), recipeType: text(v.recipeType || '', 100),
        ingredients, steps, secret, secretViewerIDs: [...new Set(secretViewerIDs)], cookingTime, recipeFor,
        image: text(v.image || '', 4096), imageKey: text(v.imageKey || '', 512), tags: list(v.tags || [], 50).map(tag => text(tag, 100)) };
}
