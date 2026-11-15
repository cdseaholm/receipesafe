'use client'

import ActionButton from "@/components/buttons/basicActionButton"
import FamilySettingsHooks from "@/app/(content)/family/[famid]/hooks/family-settings-hooks"
import { useNavigation } from "@/components/hooks/menu/use-navigation-hook"
import { useFamilyStore } from "@/context/familyStore"
import { useUserStore } from "@/context/userStore"
import { IFamily } from "@/models/types/family/family"
import { IUser } from "@/models/types/personal/user"
import { FaRegTrashAlt, FaSignOutAlt } from "react-icons/fa"
import { LeaveFamily } from "@/utils/server-actions/family/members"
import { toast } from "sonner"
import { Alert, Anchor, Button, Group, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';


export default function FamilySettings({ userFamAdminPrivs, family, userInfo }: { userFamAdminPrivs: boolean, family: IFamily, userInfo: IUser }) {

    const { navigate } = useNavigation();
    const router = useRouter();
    const { handleConfirmFam, submitChange, changeFamNameForm } = FamilySettingsHooks();
    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [confirmationName, setConfirmationName] = useState('');
    const [busy, setBusy] = useState(false);
    const numOfAdmins = family.familyMembers.filter(member => member.memberConnected && member.permissionStatus === 'Admin').length;
    const leavingWouldRemoveOnlyAdmin = userFamAdminPrivs && numOfAdmins <= 1;
    const setFamily = useFamilyStore(s => s.setFamily);
    const setUserInfo = useUserStore(s => s.setUserInfo);

    const openRename = () => {
        changeFamNameForm.setValues({ currName: family.name, name: '', namePassword: '' });
        changeFamNameForm.clearErrors();
        setRenameOpen(true);
    };

    const closeDelete = () => {
        setDeleteOpen(false);
        setDeletePassword('');
        setConfirmationName('');
    };

    const renameFamily = async () => {
        setBusy(true);
        try {
            if (await submitChange({ changeFamNameForm, userFamAdminPrivs, family })) {
                setRenameOpen(false);
                changeFamNameForm.reset();
                router.refresh();
            }
        } catch {
            toast.error('Unable to rename the family. Please try again.');
        } finally { setBusy(false); }
    };

    const deleteFamily = async () => {
        if (!deletePassword || confirmationName.trim() !== family.name.trim()) return;
        setBusy(true);
        try {
            if (await handleConfirmFam(userFamAdminPrivs, family, deletePassword, confirmationName)) {
                closeDelete();
                toast.success('Family archived. A former admin can recover it within 30 days.');
                navigate('/family');
                router.refresh();
            }
        } catch {
            toast.error('Unable to archive the family. Please try again.');
        } finally { setBusy(false); }
    };

    const handleLeaveFamily = async () => {
        if (leavingWouldRemoveOnlyAdmin) {
            toast.error("Assign another admin before leaving this family.");
            return;
        }
        const confirmLeave = confirm("Are you sure you want to leave the family?");
        if (confirmLeave) {
            const leaving = await LeaveFamily(family._id, '/');
            if (!leaving) {
                toast.error("Error leaving family. Please try again later.");
                return;
            }
            if (leaving.success) {
                setFamily({} as IFamily);
                const newUserInfo = { ...userInfo, userFamilyID: '' };
                setUserInfo(newUserInfo);
                toast.success("You have left the family.");
                navigate("/");
            } else {
                toast.error("Error leaving family: " + leaving.message);
            }
        }
    }

    const buttonItems =
        <div className="flex flex-col justify-start items-center space-y-12 pt-12 w-full flex-1 min-h-[40dvh]">
            <h1 className="text-xl md:text-2xl underline">Account Settings</h1>

            {userFamAdminPrivs && <ActionButton buttonTitle="Change Family name" action={openRename} width="w-4/5 sm:w-3/5 md:w-1/2" />}

            {userFamAdminPrivs && <ActionButton buttonTitle="Edit Members" action={() => {
                navigate(`/family/${family._id}/members`);
            }} width="w-4/5 sm:w-3/5 md:w-1/2" />}

            <button type="button" className={`flex flex-row justify-center items-center border border-neutral-200 rounded-md hover:bg-yellow-200 bg-yellow-400 p-2 w-1/2 text-xs sm:text-sm cursor-pointer`} onClick={handleLeaveFamily} aria-label={'Leave family'}>
                <FaSignOutAlt className="inline mr-2" />
                <p>Leave Family</p>
            </button>

            {userFamAdminPrivs && <button type="button" className={`flex flex-row justify-center items-center border border-neutral-200 rounded-md hover:bg-red-200 bg-red-400 p-2 w-1/2 text-xs sm:text-sm cursor-pointer`} onClick={() => setDeleteOpen(true)} aria-label={'Delete family'}>
                <FaRegTrashAlt className="inline mr-2" />
                <p>Delete Family</p>
            </button>}
            <Anchor component={Link} href="/family/recovery">Recover a family</Anchor>
        </div>

    return (
        <>
            {buttonItems}
            <Modal opened={renameOpen} onClose={busy ? () => undefined : () => { setRenameOpen(false); changeFamNameForm.reset(); }} title="Change family name" centered>
                <form onSubmit={changeFamNameForm.onSubmit(renameFamily)}>
                    <Stack>
                        <Text size="sm">Current name: {family.name}</Text>
                        <TextInput label="New family name" maxLength={100} required key={changeFamNameForm.key('name')} {...changeFamNameForm.getInputProps('name')} />
                        <PasswordInput label="Your current password" autoComplete="current-password" required key={changeFamNameForm.key('namePassword')} {...changeFamNameForm.getInputProps('namePassword')} />
                        <Text size="sm" c="dimmed">Use only Google? <Anchor component={Link} href="/verify-email">Set a password using a recovery link</Anchor> before making password-confirmed family changes.</Text>
                        <Group justify="flex-end"><Button variant="subtle" disabled={busy} onClick={() => { setRenameOpen(false); changeFamNameForm.reset(); }}>Cancel</Button><Button type="submit" loading={busy}>Save name</Button></Group>
                    </Stack>
                </form>
            </Modal>
            <Modal opened={deleteOpen} onClose={busy ? () => undefined : closeDelete} title="Delete family" centered>
                <Stack>
                    <Alert color="red">This removes the family from every member&apos;s active account. A former admin can recover it for 30 days. All recipes remain in their creators&apos; collections; family recipes return to personal recipes.</Alert>
                    <Text size="sm">Type <strong>{family.name}</strong> and enter your current password to confirm.</Text>
                    <TextInput label="Family name confirmation" value={confirmationName} onChange={event => setConfirmationName(event.currentTarget.value)} autoComplete="off" disabled={busy} />
                    <PasswordInput label="Your current password" value={deletePassword} onChange={event => setDeletePassword(event.currentTarget.value)} autoComplete="current-password" disabled={busy} />
                    <Text size="sm" c="dimmed">Use only Google? <Anchor component={Link} href="/verify-email">Set a password using a recovery link</Anchor> first.</Text>
                    <Group justify="flex-end"><Button variant="subtle" disabled={busy} onClick={closeDelete}>Cancel</Button><Button color="red" loading={busy} disabled={!deletePassword || confirmationName.trim() !== family.name.trim()} onClick={() => void deleteFamily()}>Delete family</Button></Group>
                </Stack>
            </Modal>
        </>
    )
}
