'use client';

import Link from 'next/link';
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconInfoCircle, IconTrash } from '@tabler/icons-react';
import AttemptDeleteUser from '@/utils/apihelpers/delete/deleteUser';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import AccountSettings from './account-settings';
import { toast } from 'sonner';
import { COMMUNITIES_ENABLED } from '@/lib/features';
import RecipeTransfers from './recipe-transfers';

export default function SettingsTab() {
    const [closureModalOpen, setClosureModalOpen] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const [password, setPassword] = useState('');
    const [isClosing, setIsClosing] = useState(false);

    const resetClosureModal = () => {
        if (isClosing) return;
        setConfirmation('');
        setPassword('');
        setClosureModalOpen(false);
    };

    const handleCloseAccount = async () => {
        if (isClosing) return;
        if (confirmation !== 'DELETE' || !password) {
            toast.error('Enter your current password and type DELETE to confirm account closure.');
            return;
        }
        setIsClosing(true);
        try {
            const result = await AttemptDeleteUser({ password, confirmation });
            if (!result.status) return;
            const callbackUrl = `/login?closed=1${result.purgeAfter ? `&recoverBy=${encodeURIComponent(result.purgeAfter)}` : ''}`;
            try { await signOut({ callbackUrl }); }
            catch { window.location.assign(callbackUrl); }
        } finally {
            setPassword('');
            setIsClosing(false);
        }
    };

    return (
        <>
            <section className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                <Stack gap="md" className="min-h-0 rounded-md border border-accent/15 bg-secondaryBack p-4 sm:p-5">
                    <div>
                        <h2 className="mb-1 text-xl font-bold sm:text-2xl">Account Settings</h2>
                        <Text c="dimmed" size="sm">Keep your account details and recovery email up to date.</Text>
                    </div>
                    <Alert icon={<IconInfoCircle size={18} />} color="yellow" variant="light">
                        Your recipes and family data are active.
                    </Alert>
                    <AccountSettings />
                    <RecipeTransfers />
                </Stack>

                <Stack gap="md" justify="space-between" className="min-h-0 rounded-md border border-red-200/70 bg-red-50/50 p-4 sm:p-5">
                    <div>
                        <h3 className="mb-1 text-lg font-bold text-red-700">Close account</h3>
                        <Text c="dimmed" size="sm">
                            Closing your account signs you out immediately and starts a 30-day recovery period.
                            Your account ID and recipe ownership are preserved during that period.
                        </Text>
                    </div>
                    <Alert icon={<IconAlertTriangle size={18} />} color="red" variant="light">
                        Assign another connected family admin, or archive your family first, if you are its only admin.
                        {COMMUNITIES_ENABLED && ' Community admins must also transfer administration first.'}
                    </Alert>
                    <Text size="sm">
                        Before closing, delete recipes you no longer want or offer selected shared family recipes to an accepting family admin.
                        After 30 days, recipes still owned by this account and the account itself are permanently deleted.
                        Accepted transfers remain with their new owner.
                    </Text>
                    <Text size="sm">
                        Recover before the deadline through <Link href="/verify-email" className="underline">email recovery</Link>.
                        Recovery restores the same account and its remaining recipes. It does not automatically rejoin a family;
                        request a new invitation, or recover an archived family if you are eligible.
                    </Text>
                    <Button type="button" variant="light" color="red" leftSection={<IconTrash size={16} />}
                        onClick={() => setClosureModalOpen(true)} className="mt-auto w-full">
                        Close account
                    </Button>
                </Stack>
            </section>

            <Modal opened={closureModalOpen} onClose={resetClosureModal} title="Close account for deletion" centered>
                <Stack gap="md">
                    <Alert icon={<IconAlertTriangle size={18} />} color="red" variant="light">
                        You will be signed out and removed from active family memberships now. You can recover this account for 30 days.
                        After the deadline, the account and recipes that have not been transferred are permanently deleted.
                    </Alert>
                    <Text size="sm">
                        Only accepted recipe transfers change ownership. Pending offers do not prevent deletion after the deadline.
                        If you are your family&apos;s only connected admin, transfer administration or archive the family first.
                    </Text>
                    <PasswordInput label="Current password" value={password}
                        onChange={event => setPassword(event.currentTarget.value)} disabled={isClosing}
                        autoComplete="current-password" maxLength={256} />
                    <Text size="sm" c="dimmed">
                        Use <Link href="/verify-email" className="underline">email recovery to set a password</Link> first if you normally sign in with Google.
                    </Text>
                    <TextInput label="Type DELETE to confirm" value={confirmation}
                        onChange={event => setConfirmation(event.currentTarget.value)} disabled={isClosing}
                        autoComplete="off" spellCheck={false} />
                    <Group justify="flex-end">
                        <Button type="button" variant="subtle" color="gray" onClick={resetClosureModal} disabled={isClosing}>Cancel</Button>
                        <Button type="button" color="red" loading={isClosing} disabled={confirmation !== 'DELETE' || !password}
                            onClick={handleCloseAccount}>Close account and sign out</Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
