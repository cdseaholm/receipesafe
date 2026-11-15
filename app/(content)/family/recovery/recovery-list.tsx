'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { toast } from 'sonner';
import { RestoreFamily } from '@/utils/server-actions/family/delete';

type Archive = { id: string; name: string; restoreUntil: string };
export default function RecoveryList({ families, hasCurrentFamily }: { families: Archive[]; hasCurrentFamily: boolean }) {
    const router = useRouter();
    const [selected, setSelected] = useState<Archive | null>(null);
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    async function restore() {
        if (!selected || confirmation.trim() !== selected.name || !password) return;
        setBusy(true);
        try {
            const result = await RestoreFamily(selected.id, password, confirmation);
            if (!result.success) { toast.error(result.message); return; }
            toast.success(result.message);
            router.push(`/family/${selected.id}`); router.refresh();
            setSelected(null);
        } catch { toast.error('Unable to recover family. Please retry.'); }
        finally { setBusy(false); setPassword(''); }
    }
    return <Stack>
        {hasCurrentFamily && <Text c="dimmed">Leave your current family before recovering an archived one.</Text>}
        {!families.length && <Text c="dimmed">There are no recoverable families for your account.</Text>}
        {families.map(family => <div key={family.id} className="rounded-md border border-accent/20 p-4">
            <h2 className="font-semibold">{family.name}</h2>
            <p className="mb-3 text-sm">Recover before {new Date(family.restoreUntil).toLocaleDateString()}.</p>
            <Button disabled={hasCurrentFamily} onClick={() => { setSelected(family); setConfirmation(''); setPassword(''); }}>Recover family</Button>
        </div>)}
        <Modal opened={Boolean(selected)} onClose={() => !busy && setSelected(null)} title="Recover family" centered>
            <Stack><Text>Type {selected?.name} and confirm your password.</Text>
                <TextInput label="Family name" value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)} disabled={busy} />
                <PasswordInput label="Current password" value={password} onChange={event => setPassword(event.currentTarget.value)} disabled={busy} autoComplete="current-password" />
                <Text size="sm"><Link href="/verify-email" className="underline">Set or recover a password</Link> if you normally use Google sign-in.</Text>
                <Button loading={busy} disabled={!password || confirmation.trim() !== selected?.name} onClick={restore}>Recover family</Button>
            </Stack>
        </Modal>
    </Stack>;
}
