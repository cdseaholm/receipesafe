'use client';

import { useUserStore } from '@/context/userStore';
import { useFamilyStore } from '@/context/familyStore';
import { useDataStore } from '@/context/dataStore';
import { useCommunityStore } from '@/context/communityStore';
import { useModalStore } from '@/context/modalStore';
import { useAlertStore } from '@/context/alertStore';
import { useStateStore } from '@/context/stateStore';

export function resetSessionStores() {
  useUserStore.setState(useUserStore.getInitialState(), true);
  useFamilyStore.setState(useFamilyStore.getInitialState(), true);
  useDataStore.setState(useDataStore.getInitialState(), true);
  useCommunityStore.setState(useCommunityStore.getInitialState(), true);
  useModalStore.setState(useModalStore.getInitialState(), true);
  useAlertStore.setState(useAlertStore.getInitialState(), true);
  useStateStore.setState(useStateStore.getInitialState(), true);
}

export function shouldResetSessionStores(previousId: string | null, currentId: string, storedId: string, status: string) {
  if (status === 'loading') return false;
  return Boolean(previousId && previousId !== currentId) || Boolean(storedId && storedId !== currentId);
}
