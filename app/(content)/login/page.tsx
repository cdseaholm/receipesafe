
import { Metadata } from "next";
import { redirect } from "next/navigation";
import SignInLanding from "@/app/(content)/login/components/sign-in-landing";
import { getSessionUser } from "@/lib/data/user";
import { createPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = createPageMetadata({
    title: "Log In",
    description: "Log in to RecipeSafe to manage recipes, family spaces, saved recipes, and account settings.",
    robots: { index: false, follow: true },
});

export default async function Page({ searchParams }: { searchParams: Promise<{ closed?: string; recoverBy?: string }> }) {

    const userInfo = await getSessionUser();

    if (userInfo) {
        redirect('/u/profile');
    }
    const params = await searchParams;
    const deadline = params.recoverBy ? new Date(params.recoverBy) : null;

    return (

        <SignInLanding closed={params.closed === '1'} recoveryDeadline={deadline && Number.isFinite(deadline.getTime()) ? deadline.toUTCString() : undefined} />

    );
}
