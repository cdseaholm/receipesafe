'use client'

import { useModalStore } from "@/context/modalStore";
import { useUserStore } from "@/context/userStore";
import { useStateStore } from "@/context/stateStore";
import { modals } from "@mantine/modals";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { toast } from "sonner";
import { useEnsureData } from "../data/useEnsureData";
import { IRecipe } from "@/models/types/recipes/recipe";
import { IUser } from "@/models/types/personal/user";
import { useWindowSizes } from "@/context/width-height-store";
import { COMMUNITIES_ENABLED, COMMUNITIES_COMING_LATER_MESSAGE } from '@/lib/features';
import { resetSessionStores } from '@/lib/security/session-stores';

export default function MenuPanelHooks() {
    
    const setOpenCreateRecipeModal = useModalStore(state => state.setOpenRecipeForm);
    const setOpenCreateFamilyModal = useModalStore(state => state.setOpenCreateFamilyModal);
    const setOpenSignInModal = useModalStore(state => state.setOpenSignInModal);
    const handleZoomReset = useStateStore(state => state.handleZoomReset);
    const setGlobalLoading = useStateStore(state => state.setGlobalLoading);
    const { width } = useWindowSizes();
    
    // Get user data from store
    const userInfo = useUserStore(state => state.userInfo);
    const userFamilyID = userInfo?.userFamilyID || '';

    // Hook to ensure ingredients are loaded before opening recipe modal
    const { ensureReady: ensureIngredients, isLoading: loadingIngredients } = useEnsureData('ingredients');
    const [isPreparingModal, setIsPreparingModal] = useState(false);

    const handleOpenRecipeModal = async (recipe: IRecipe | null, userInfo: IUser | null, from: 'personal' | 'family' | 'community' | 'post' | null) => {
        if (!COMMUNITIES_ENABLED && (from === 'community' || from === 'post')) {
            toast.info(COMMUNITIES_COMING_LATER_MESSAGE);
            return;
        }
        setIsPreparingModal(true);
        try {
            if (userInfo && recipe && userInfo._id === recipe.creatorID) {
                setOpenCreateRecipeModal({type: 'edit', recipe: recipe, from: from, fromId: from === 'family' ? userInfo?.userFamilyID || null : null});
            } else if (recipe === null) {
                setOpenCreateRecipeModal({type: 'create', recipe: null, from: from, fromId: from === 'family' ? userInfo?.userFamilyID || null : null});
            } else {
                toast.error('Failed to load recipe data. Please try again.');
                return;
            }

            await ensureIngredients();
        } catch (error) {
            console.error('Error loading ingredients:', error);
            toast.error('Failed to load recipe data. Please try again.');
        } finally {
            setIsPreparingModal(false);
        }
    };

    const signingOut = async () => {
        resetSessionStores();
        setGlobalLoading(true);
        try {
            await signOut();
            handleZoomReset(width, false);
        } finally {
            setGlobalLoading(false);
        }
    }

    const handleSignOutClick = () => {
        modals.openConfirmModal({
            closeOnClickOutside: true,
            closeOnConfirm: true,
            closeOnCancel: true,
            closeOnEscape: true,
            title: 'Are you sure you want to sign out?',
            labels: { confirm: 'Sign out', cancel: 'Cancel' },
            onConfirm: () => signingOut(),
        });
    };

    const handleSignInClick = () => {
        setOpenSignInModal(true);
    };

    const handleSetOpenCreateFamilyModal = () => {
        setOpenCreateFamilyModal(true);
    };

    return {
        handleOpenRecipeModal,
        isPreparingModal,
        loadingIngredients,
        userFamilyID,
        handleSignOutClick,
        handleSignInClick,
        handleSetOpenCreateFamilyModal,
    };
}
