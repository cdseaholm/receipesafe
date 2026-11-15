'use client'

import SignInPage from "@/components/modals/intercepted-components/mainLogin";
import ContentWrapper from "@/components/wrappers/contentWrapper";
import NavWrapper from "@/components/wrappers/navWrapper";
import { useStateStore } from "@/context/stateStore";
import { useRouter } from "next/navigation";
import Link from 'next/link';
import { Alert } from '@mantine/core';

export default function SignInLanding({ closed = false, recoveryDeadline }: { closed?: boolean; recoveryDeadline?: string }) {

    const setGlobalLoading = useStateStore(state => state.setGlobalLoading);
    const router = useRouter();

    const handleCancel = () => {
        router.push('/');
    }

    const handleLoading = (loadState: boolean) => {
        setGlobalLoading(loadState);
    }

    return (
        <NavWrapper userInfo={null}>
            <ContentWrapper containedChild={false} paddingNeeded={true}>
                {closed && <Alert color="yellow" title="Account closed" className="mb-4">
                    You are signed out. Your account and recipe ownership are preserved for 30 days.
                    {' '}Use <Link href="/verify-email" className="underline">email recovery</Link>
                    {recoveryDeadline ? ` before ${recoveryDeadline}` : ' before the recovery deadline'} to restore your account.
                    {' '}After the deadline, recipes still owned by this account and the account itself are permanently deleted.
                    Accepted recipe transfers stay with their new owner. Recovery does not automatically restore family membership.
                </Alert>}
                <SignInPage handleCancel={handleCancel} handleLoading={handleLoading} />
            </ContentWrapper>
        </NavWrapper>
    );
} 
