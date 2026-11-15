import { redirect } from 'next/navigation';
import Link from 'next/link';
import Family from '@/models/family';
import { getSessionUser } from '@/lib/data/user';
import NavWrapper from '@/components/wrappers/navWrapper';
import ContentWrapper from '@/components/wrappers/contentWrapper';
import { createPageMetadata } from '@/lib/metadata';
import RecoveryList from './recovery-list';

export const dynamic = 'force-dynamic';
export const metadata = createPageMetadata({ title: 'Recover a Family', description: 'Recover a family archived in the last 30 days.', robots: { index: false, follow: false } });
export default async function Page() {
    const user = await getSessionUser();
    if (!user) redirect('/login');
    const families = await Family.find({ deletedAt: { $ne: null }, restoreUntil: { $gt: new Date() },
        familyMembers: { $elemMatch: { familyMemberID: user._id, memberConnected: true, permissionStatus: 'Admin' } },
    }).select('name restoreUntil familyMembers').limit(30).lean();
    return <NavWrapper userInfo={user}><ContentWrapper containedChild paddingNeeded>
        <section className="mx-auto w-full max-w-2xl space-y-5">
            <h1 className="text-2xl font-bold">Recover a family</h1>
            <p>Family admins can recover an archived family within 30 days. Personal recipes are always preserved. People who joined another family will not be moved.</p>
            <RecoveryList hasCurrentFamily={Boolean(user.userFamilyID)} families={families.map(family => ({ id: String(family._id), name: family.name, restoreUntil: new Date(family.restoreUntil!).toISOString() }))} />
            <Link href="/family" className="underline">Back to family</Link>
        </section>
    </ContentWrapper></NavWrapper>;
}
