'use client'

import { useSession } from "next-auth/react";
import { Box, LoadingOverlay } from "@mantine/core";
import ModalProvider from "../providers/modalProvider";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useStateStore } from "@/context/stateStore";
import { useUserStore } from '@/context/userStore';
import { resetSessionStores, shouldResetSessionStores } from '@/lib/security/session-stores';

export default function StateWrapper({ children }: { children: React.ReactNode }) {


    const { data: session, update, status } = useSession();
    const currentUserId = session?.user?.id || '';
    const storedUserId = useUserStore(state => state.userInfo?._id || '');
    const previousUserId = useRef<string | null>(null);
    const redirecting = useRef(false);
    const changedIdentity = shouldResetSessionStores(previousUserId.current, currentUserId, storedUserId, status);
    const pathname = usePathname();
    const isNavigating = useStateStore(state => state.isNavigating);
    const setIsNavigating = useStateStore(state => state.setIsNavigating);
    const setGlobalLoading = useStateStore(state => state.setGlobalLoading);

    const handleUpdate = async () => {
        await update();
    };

    useEffect(() => {
        setIsNavigating(false);
        setGlobalLoading(false);
    }, [pathname, setIsNavigating, setGlobalLoading]);

    useEffect(() => {
        if (status === 'loading') return;
        if (changedIdentity && !redirecting.current) {
            redirecting.current = true;
            resetSessionStores();
            // Discard the router cache and old server props as well as client state.
            window.location.replace(currentUserId ? '/' : '/login');
            return;
        }
        previousUserId.current = currentUserId;
    }, [status, currentUserId, changedIdentity]);

    if (changedIdentity || redirecting.current || (status === 'loading' && storedUserId)) {
        return <Box pos="relative" w="100dvw" h="100dvh"><LoadingOverlay visible zIndex={1000} /></Box>;
    }

    return (
        <Box pos={'relative'} w={'100dvw'} h={'100dvh'}>
            <LoadingOverlay
                visible={isNavigating}
                zIndex={1000}
                overlayProps={{ radius: "sm", blur: 0, bg: '#E8D8C4' }}
            />
            <ModalProvider session={session} handleUpdate={handleUpdate} />
            {children}
        </Box>
    );
}
