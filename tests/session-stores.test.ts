import test from 'node:test';
import assert from 'node:assert/strict';
import { resetSessionStores, shouldResetSessionStores } from '@/lib/security/session-stores';
import { useUserStore } from '@/context/userStore';
import { useFamilyStore } from '@/context/familyStore';
import { useDataStore } from '@/context/dataStore';
import { useCommunityStore } from '@/context/communityStore';
import { useModalStore } from '@/context/modalStore';
import { useAlertStore } from '@/context/alertStore';

test('session identity transitions clear stale accounts without interrupting matching hydration', () => {
  assert.equal(shouldResetSessionStores(null, 'alice', 'alice', 'authenticated'), false);
  assert.equal(shouldResetSessionStores('alice', '', 'alice', 'loading'), false);
  assert.equal(shouldResetSessionStores('alice', '', 'alice', 'unauthenticated'), true);
  assert.equal(shouldResetSessionStores('alice', 'bob', 'alice', 'authenticated'), true);
  assert.equal(shouldResetSessionStores(null, 'bob', 'alice', 'authenticated'), true);
  assert.equal(shouldResetSessionStores('', '', '', 'unauthenticated'), false);
  assert.equal(shouldResetSessionStores('', 'alice', '', 'authenticated'), false);
  assert.equal(shouldResetSessionStores('', 'alice', 'alice', 'authenticated'), false);
});

test('reset clears private data, drafts, invitations and modals while retaining working store actions', () => {
  useUserStore.setState({ userInfo: { _id: 'alice' } as never, userRecipes: [{}] as never, inquiries: [{}] as never });
  useFamilyStore.setState({ family: { _id: 'private-family' } as never, familyRecipes: [{}] as never, invite: {} as never });
  useDataStore.setState({ communities: [{}] as never, recipeForPostAndPostBackup: { recipe: {} as never, backupPost: null } });
  useCommunityStore.setState({ creator: {} as never, communityPosts: [{}] as never });
  useModalStore.setState({ openCreateFamilyModal: true, openRecipeForm: { type: 'edit', recipe: {} as never, from: 'personal', fromId: null } });
  useAlertStore.setState({ alertMessage: 'Previous account data', alertModalOpen: true });
  resetSessionStores();
  assert.deepEqual(useUserStore.getState().userInfo, {});
  assert.equal(useUserStore.getState().userRecipes.length, 0);
  assert.equal(useUserStore.getState().inquiries.length, 0);
  assert.deepEqual(useFamilyStore.getState().family, {});
  assert.equal(useFamilyStore.getState().familyRecipes.length, 0);
  assert.equal(useFamilyStore.getState().invite, null);
  assert.equal(useDataStore.getState().recipeForPostAndPostBackup, null);
  assert.equal(useCommunityStore.getState().creator, null);
  assert.equal(useCommunityStore.getState().communityPosts.length, 0);
  assert.equal(useModalStore.getState().openCreateFamilyModal, false);
  assert.equal(useModalStore.getState().openRecipeForm.recipe, null);
  assert.equal(useAlertStore.getState().alertMessage, '');
  assert.equal(useAlertStore.getState().alertModalOpen, false);
  useUserStore.getState().setUserInfo({ _id: 'bob' } as never);
  assert.equal(useUserStore.getState().userInfo._id, 'bob');
  resetSessionStores();
});
