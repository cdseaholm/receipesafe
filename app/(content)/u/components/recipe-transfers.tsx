'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, PasswordInput, Select, Stack, Text } from '@mantine/core';
import { toast } from 'sonner';

type Offer = {
    id: string;
    direction: 'incoming' | 'outgoing';
    recipeName: string;
    otherName: string;
    status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
    expiresAt: string;
};
type TransferData = {
    recipes: { id: string; name: string }[];
    admins: { id: string; name: string }[];
    offers: Offer[];
};

export default function RecipeTransfers() {
    const [data, setData] = useState<TransferData | null>(null);
    const [error, setError] = useState('');
    const [recipeID, setRecipeID] = useState<string | null>(null);
    const [toUserID, setToUserID] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [accepting, setAccepting] = useState<Offer | null>(null);

    const load = useCallback(async () => {
        try {
            const response = await fetch('/api/recipe-transfers', { cache: 'no-store' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Unable to load recipe transfers.');
            setData(result);
            setError('');
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Unable to load recipe transfers.');
        }
    }, []);
    useEffect(() => { void load(); }, [load]);

    const submit = async (body: Record<string, unknown>) => {
        if (busy) return;
        setBusy(true);
        try {
            const response = await fetch('/api/recipe-transfers', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Unable to update this transfer.');
            toast.success(result.message);
            setPassword('');
            setAccepting(null);
            await load();
        } catch (failure) {
            toast.error(failure instanceof Error ? failure.message : 'Unable to update this transfer.');
        } finally { setPassword(''); setBusy(false); }
    };

    return (
        <Stack gap="md" className="rounded-md border border-accent/15 bg-secondaryBack p-4 sm:p-5">
            <div>
                <h3 className="mb-1 text-lg font-bold">Recipe ownership transfers</h3>
                <Text size="sm" c="dimmed">
                    Offer a recipe you already share with your family to one of its connected admins.
                    You keep ownership until they accept. Offers expire after seven days.
                </Text>
            </div>
            <Alert color="yellow" variant="light">
                Acceptance permanently moves ownership and the recipe into the admin&apos;s recipes.
                Recovering a closed account does not undo an accepted transfer. Edit the recipe before offering it;
                changes to its content, privacy or sharing require a new offer.
                An image shared with another recipe or avatar must be removed or replaced with a separate upload first.
                Separate step images must be removed before transfer.
            </Alert>
            {error && <Alert color="red">{error}<Button variant="subtle" size="xs" onClick={() => void load()}>Try again</Button></Alert>}
            {!data && !error && <Text size="sm" c="dimmed">Loading recipe transfers…</Text>}
            {data && <>
                {data.recipes.length > 0 && data.admins.length > 0 ? <>
                    <Select label="Your shared family recipe" placeholder="Choose a recipe" value={recipeID} onChange={setRecipeID}
                        data={data.recipes.map(recipe => ({ value: recipe.id, label: recipe.name }))} searchable disabled={busy} />
                    <Select label="Family admin who will own the recipe" placeholder="Choose an admin" value={toUserID} onChange={setToUserID}
                        data={data.admins.map(admin => ({ value: admin.id, label: admin.name }))} searchable disabled={busy} />
                    <PasswordInput label="Confirm your current password" value={password} onChange={event => setPassword(event.currentTarget.value)}
                        autoComplete="current-password" maxLength={256} disabled={busy} />
                    <Button variant="light" disabled={!recipeID || !toUserID || !password || busy} loading={busy}
                        onClick={() => void submit({ action: 'offer', recipeID, toUserID, password })}>Offer ownership transfer</Button>
                </> : <Text size="sm" c="dimmed">
                    To offer a transfer, share one of your recipes with an active family that has another connected, verified admin.
                </Text>}
                {data.offers.length > 0 && <Stack gap="sm">
                    <Text fw={600} size="sm">Incoming and outgoing offers</Text>
                    {data.offers.map(offer => <Stack key={offer.id} gap="xs" className="rounded border border-accent/15 p-3">
                        <Group justify="space-between" wrap="wrap">
                            <Text fw={600} size="sm">{offer.recipeName}</Text>
                            <Badge variant="light" color={offer.status === 'accepted' ? 'green' : 'gray'}>{offer.status}</Badge>
                        </Group>
                        <Text size="sm">{offer.direction === 'incoming' ? 'From' : 'To'} {offer.otherName}</Text>
                        {offer.status === 'pending' && <>
                            <Text size="xs" c="dimmed">Expires {new Date(offer.expiresAt).toLocaleString()}</Text>
                            <Group>
                                {offer.direction === 'incoming' ? <>
                                    <Button size="xs" disabled={busy} onClick={() => setAccepting(offer)}>Review acceptance</Button>
                                    <Button size="xs" variant="subtle" disabled={busy} onClick={() => void submit({ action: 'decline', transferID: offer.id })}>Decline</Button>
                                </> : <Button size="xs" variant="subtle" disabled={busy}
                                    onClick={() => void submit({ action: 'cancel', transferID: offer.id })}>Cancel offer</Button>}
                            </Group>
                        </>}
                    </Stack>)}
                </Stack>}
            </>}
            <Modal opened={Boolean(accepting)} onClose={() => { if (!busy) setAccepting(null); }} title="Accept recipe ownership?" centered>
                <Stack gap="md">
                    <Text>Accept ownership of &quot;{accepting?.recipeName}&quot; from {accepting?.otherName}?</Text>
                    <Text size="sm">You will become its owner and can edit or delete it. The recipe remains shared with your family.
                        This transfer remains in place if the previous owner closes or recovers their account.</Text>
                    <Group justify="flex-end">
                        <Button variant="subtle" disabled={busy} onClick={() => setAccepting(null)}>Back</Button>
                        <Button loading={busy} onClick={() => accepting && void submit({ action: 'accept', transferID: accepting.id })}>Accept ownership</Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}
