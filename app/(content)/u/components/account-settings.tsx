'use client';
import { useState } from 'react';
import { Alert, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { signOut, useSession } from 'next-auth/react';
import GoogleSignInButton from '@/components/buttons/googleSignInButton';
import EmailVerificationRequest from '@/components/forms/personal/emailVerificationRequest';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/context/userStore';
import ProductionFeatureNotice from '@/components/misc/production-feature-notice';

export default function AccountSettings() {
  const {data: session, update: updateSession} = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function update(which: string, itemToEdit: string) {
    setBusy(true); setMessage('');
    try {
      const result = await fetch('/api/user/edit', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({which, itemToEdit, passwordEntered: currentPassword})});
      const body = await result.json(); setMessage(body.message || 'Unable to update');
      if (result.ok) {
        setCurrentPassword('');
        if (which === 'name') {
          const store = useUserStore.getState();
          store.setUserInfo({...store.userInfo, name: itemToEdit.trim()});
          setName(''); await updateSession(); router.refresh();
        }
        if (which === 'email') setEmail('');
        if (body.signInRequired) { setNewPassword(''); await signOut({callbackUrl: '/login'}); }
      }
    } catch { setMessage('Unable to update. Please try again.'); }
    finally { setBusy(false); }
  }
  return <Stack>
    <TextInput label="Display name" placeholder={session?.user?.name || ''} value={name} onChange={event => setName(event.currentTarget.value)} maxLength={100} />
    <Button disabled={!name.trim()} loading={busy} onClick={() => void update('name', name)}>Save display name</Button>
    <ProductionFeatureNotice label="Profile enhancements" features={['Edit biography', 'Change avatar']} />
    <PasswordInput label="Current password for account changes" value={currentPassword} onChange={event => setCurrentPassword(event.currentTarget.value)} autoComplete="current-password" />
    <TextInput label="New email address" type="email" value={email} onChange={event => setEmail(event.currentTarget.value)} maxLength={254} />
    <Button loading={busy} disabled={!email || !currentPassword} onClick={() => void update('email', email)}>Send email change confirmation</Button>
    <PasswordInput label="New password" description="At least 12 characters; maximum 72 UTF-8 bytes" value={newPassword} onChange={event => setNewPassword(event.currentTarget.value)} autoComplete="new-password" />
    <Button loading={busy} disabled={!newPassword || !currentPassword} onClick={() => void update('password', newPassword)}>Change password and sign out</Button>
    {message && <Alert>{message}</Alert>}
    <Text size="sm">Forgot your password or use only Google? Send a recovery link to set a password before password-confirmed changes.</Text>
    <EmailVerificationRequest initialEmail={session?.user?.email || ''} />
    <Text size="sm">Link your Google account while signed in here. Its verified email must match this account.</Text>
    <GoogleSignInButton label="Link Google account" />
  </Stack>;
}
