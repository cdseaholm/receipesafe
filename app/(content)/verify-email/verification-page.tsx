'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Container, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { signIn, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import EmailVerificationRequest from '@/components/forms/personal/emailVerificationRequest';
import { validNewPassword } from '@/lib/auth/policy';
import { toast } from 'sonner';

export default function VerificationPage() {
  const [token, setToken] = useState('');
  const [invite, setInvite] = useState('');
  const [email, setEmail] = useState('');
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setToken(fragment.get('token') || ''); setInvite(fragment.get('invite') || '');
    setEmail(new URLSearchParams(window.location.search).get('email') || '');
    window.history.replaceState(null, '', '/verify-email'); setReady(true);
  }, []);
  if (!ready) return null;
  return <Container size="xs" py="xl"><Stack gap="lg">
    <Title order={1}>{token ? 'Confirm your email and choose a password' : 'Verify or recover your account'}</Title>
    <Text>Confirm your email and choose a new password to verify your account or restore access. Older sessions will be signed out.</Text>
    <Text size="sm">If you requested account deletion, you can recover only before the original 30-day deadline. Your account and recipes are preserved during that period. Recovery does not automatically restore family membership. Request a new invitation, or recover an archived family if you are eligible.</Text>
    {token ? <form onSubmit={async event => {
      event.preventDefault(); setMessage('');
      if (!validNewPassword(password) || password !== confirmation) { setMessage('Passwords must match and use at least 12 characters, up to 72 UTF-8 bytes'); return; }
      setBusy(true);
      try {
        const response = await fetch('/api/account/verification/confirm', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token, password})});
        const body = await response.json();
        if (!response.ok) { setMessage(body.message); return; }
        await signOut({redirect: false});
        const login = await signIn('credentials', {email: body.email, password, redirect: false});
        if (login?.ok && !login.error) {
          if (body.recoveredAccount) toast.success('Account recovered. Your remaining recipes are preserved. Family membership is not automatically restored.', {duration: 10000});
          router.replace(/^[a-f\d]{40,128}$/i.test(invite) ? `/invite?token=${encodeURIComponent(invite)}` : '/u/profile'); router.refresh();
        } else { setToken(''); setMessage(body.recoveredAccount ? 'Your account is recovered and password saved. Sign in again. Family membership is not automatically restored.' : 'Your email is verified and password saved. Continue to the sign-in page.'); }
      } catch { setMessage('Unable to confirm. Try again or request a new link.'); }
      finally { setBusy(false); }
    }}><Stack>
      <PasswordInput label="New password" required minLength={12} maxLength={72} value={password} onChange={event => setPassword(event.currentTarget.value)} autoComplete="new-password" />
      <PasswordInput label="Confirm new password" required value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)} autoComplete="new-password" />
      <Button type="submit" loading={busy}>Confirm email and save password</Button>
    </Stack></form> : <EmailVerificationRequest key={email} initialEmail={email} />}
    {message && <Alert>{message}</Alert>}
    <Text component="a" href="/login">Return to sign in</Text>
  </Stack></Container>;
}

