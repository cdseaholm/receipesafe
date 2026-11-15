import { toast } from 'sonner';
import { resetSessionStores } from '@/lib/security/session-stores';
import { readApiResponse } from '../api-response';

export interface HelperResponse {
    status: boolean;
    message: string;
}

type ClosureResponse = HelperResponse & { purgeAfter?: string };

export default async function AttemptDeleteUser({ password, confirmation }: {
    password: string;
    confirmation: string;
}): Promise<ClosureResponse> {
    if (!password || confirmation !== 'DELETE') {
        const message = 'Enter your current password and type DELETE to close your account.';
        toast.error(message);
        return { status: false, message };
    }
    try {
        const response = await fetch('/api/user/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, confirmation }),
        });
        const result = await readApiResponse<{ purgeAfter?: string }>(response, 'Unable to close account');
        if (!result.status) {
            toast.error(result.message);
            return { status: false, message: result.message };
        }
        const purgeAfter = typeof result.data?.purgeAfter === 'string' ? result.data.purgeAfter : undefined;
        resetSessionStores();
        toast.success(result.message || 'Account closed. You can recover it within 30 days.');
        return { status: true, message: result.message, purgeAfter };
    } catch {
        const message = 'Unable to confirm account closure. Please try again.';
        toast.error(message);
        return { status: false, message };
    }
}
