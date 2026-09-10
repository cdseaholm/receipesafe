'use client'

import ContentWrapper from "@/components/wrappers/contentWrapper";
import NavWrapper from "@/components/wrappers/navWrapper";
import { DashboardCard, DashboardHeader } from "@/components/layout/page-shells";
import { useModalStore } from "@/context/modalStore";
import { useUserStore } from "@/context/userStore";
import { IUser } from "@/models/types/personal/user";
import { Badge, Button, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCheck, IconInbox, IconPlus, IconUsers, IconX } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export type FamilyStartInvite = {
    email: string;
    familyID: string;
    familyName: string;
    token: string;
    read?: boolean;
    createdAt: Date | string;
};

export default function FamilyStartPage({ user, familyInvites }: { user: IUser; familyInvites: FamilyStartInvite[] }) {
    const router = useRouter();
    const setOpenCreateFamilyModal = useModalStore(state => state.setOpenCreateFamilyModal);
    const setUserInfo = useUserStore(state => state.setUserInfo);
    const [invites, setInvites] = useState(familyInvites);
    const [busyToken, setBusyToken] = useState<string | null>(null);

    const handleCreateFamily = () => {
        setOpenCreateFamilyModal(true);
    };

    const handleAccept = async (invite: FamilyStartInvite) => {
        setBusyToken(invite.token);

        try {
            const response = await fetch('/api/invite/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: invite.token }),
            });
            const data = await response.json().catch(() => null);

            if (!response.ok || data?.status !== 200) {
                toast.error(data?.message || 'Failed to accept invite');
                return;
            }

            setInvites(current => current.filter(item => item.token !== invite.token));
            setUserInfo({ ...user, userFamilyID: invite.familyID });
            toast.success(`Joined ${invite.familyName}`);
            router.refresh();
            router.push(`/family/${invite.familyID}`);
        } catch (error) {
            console.error('Failed to accept family invite:', error);
            toast.error('Failed to accept invite');
        } finally {
            setBusyToken(null);
        }
    };

    const handleDecline = async (invite: FamilyStartInvite) => {
        const confirmed = window.confirm(`Decline the invite to join ${invite.familyName}?`);
        if (!confirmed) return;

        setBusyToken(invite.token);

        try {
            const response = await fetch('/api/invite/decline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: invite.token }),
            });
            const data = await response.json().catch(() => null);

            if (!response.ok || data?.status !== 200) {
                toast.error(data?.message || 'Failed to decline invite');
                return;
            }

            setInvites(current => current.filter(item => item.token !== invite.token));
            toast.success('Invite declined');
            router.refresh();
        } catch (error) {
            console.error('Failed to decline family invite:', error);
            toast.error('Failed to decline invite');
        } finally {
            setBusyToken(null);
        }
    };

    return (
        <NavWrapper userInfo={user}>
            <ContentWrapper containedChild={false} paddingNeeded={true}>
                <div className="flex min-h-[72dvh] w-full flex-col items-center justify-start">
                    <DashboardCard className="gap-4">
                        <DashboardHeader
                            icon={<IconUsers size={20} />}
                            eyebrow={<Badge variant="light" color="accent">Family</Badge>}
                            title="Start your family space"
                            description="Create a family recipe space, or accept an invitation that was sent to your account."
                            aside={(
                                <Button type="button" leftSection={<IconPlus size={16} />} onClick={handleCreateFamily}>
                                    Create family
                                </Button>
                            )}
                        />

                        <section className="grid w-full gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                            <div className="rounded-md border border-accent/15 bg-mainBack/45 p-4 shadow-[var(--tightShadow)]">
                                <Stack gap="sm">
                                    <ThemeIcon variant="light" color="accent" size="lg" radius="md">
                                        <IconPlus size={19} />
                                    </ThemeIcon>
                                    <Text fw={800} size="lg">Create a family</Text>
                                    <Text size="sm" c="dimmed">
                                        Set up a shared space for recipes, members, and the traditions your family wants to preserve.
                                    </Text>
                                    <Button type="button" variant="light" leftSection={<IconPlus size={16} />} onClick={handleCreateFamily} className="self-start">
                                        Create family
                                    </Button>
                                </Stack>
                            </div>

                            <div className="rounded-md border border-accent/15 bg-mainBack/45 p-4 shadow-[var(--tightShadow)]">
                                <Stack gap="sm">
                                    <Group justify="space-between" align="center" gap="xs">
                                        <Group gap="xs">
                                            <ThemeIcon variant="light" color="accent" size="lg" radius="md">
                                                <IconInbox size={19} />
                                            </ThemeIcon>
                                            <Text fw={800} size="lg">Family invites</Text>
                                        </Group>
                                        {invites.length > 0 && (
                                            <Badge variant="light" color="red">{invites.length}</Badge>
                                        )}
                                    </Group>

                                    {invites.length > 0 ? (
                                        <Stack gap="xs">
                                            {invites.map(invite => (
                                                <div key={invite.token} className="rounded-md border border-accent/10 bg-cardBack/80 p-3">
                                                    <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                                                        <div className="min-w-0">
                                                            <Text fw={700} className="break-words">{invite.familyName}</Text>
                                                            <Text size="sm" c="dimmed">
                                                                Invited {new Date(invite.createdAt).toLocaleDateString()}
                                                            </Text>
                                                        </div>
                                                        <Group gap="xs" className="shrink-0">
                                                            <Button type="button" size="xs" loading={busyToken === invite.token} disabled={busyToken !== null && busyToken !== invite.token} leftSection={<IconCheck size={14} />} onClick={() => handleAccept(invite)}>
                                                                Accept
                                                            </Button>
                                                            <Button type="button" size="xs" variant="subtle" color="gray" loading={busyToken === invite.token} disabled={busyToken !== null && busyToken !== invite.token} leftSection={<IconX size={14} />} onClick={() => handleDecline(invite)}>
                                                                Decline
                                                            </Button>
                                                        </Group>
                                                    </Group>
                                                </div>
                                            ))}
                                        </Stack>
                                    ) : (
                                        <Text size="sm" c="dimmed">
                                            Any family invitations sent to {user.email} will appear here. You can also accept them from your profile inbox.
                                        </Text>
                                    )}
                                </Stack>
                            </div>
                        </section>
                    </DashboardCard>
                </div>
            </ContentWrapper>
        </NavWrapper>
    );
}
