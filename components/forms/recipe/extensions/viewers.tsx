'use client'
import { TagsInput } from '@mantine/core';
import { useFamilyStore } from '@/context/familyStore';
import type { RecipeFormType } from '@/models/types/recipes/review';

export default function RecipeViewers({ recipeForm }: { recipeForm: RecipeFormType; width: number }) {
    const family = useFamilyStore(state => state.family);
    const members = Array.isArray(family?.familyMembers) ? family.familyMembers : [];
    const suggestions = members.filter(member => member.memberConnected && member.familyMemberEmail)
        .map(member => member.familyMemberEmail.toLowerCase());
    return <TagsInput
        label="Private viewers"
        description="Enter the email addresses of verified RecipeSafe members. Saving the recipe checks each account. Family sharing is managed separately in the family collection."
        placeholder="name@example.com"
        data={[...new Set(suggestions)]}
        splitChars={[',', ';', ' ']}
        maxTags={200}
        key={recipeForm.key('secretViewerIDs')}
        {...recipeForm.getInputProps('secretViewerIDs')}
    />;
}
