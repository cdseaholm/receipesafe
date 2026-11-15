'use client';
import { useState } from 'react';
import { Alert, Button, Stack, TextInput } from '@mantine/core';

export default function EmailVerificationRequest({initialEmail = ''}: {initialEmail?: string}) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await fetch('/api/account/verification/request', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email})});
      const body = await result.json(); setMessage(body.message || 'Please try again later');
    } catch { setMessage('Unable to send the email. Please try again later'); }
    finally { setBusy(false); }
  }}><Stack>
    <TextInput label="Account email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.currentTarget.value)} autoComplete="email" />
    <Button type="submit" loading={busy}>Send verification or recovery link</Button>
    {message && <Alert>{message}</Alert>}
  </Stack></form>;
}
