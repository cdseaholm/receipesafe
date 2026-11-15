import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { NextRequest } from "next/server";

type NextAuthContext = {
    params: Promise<{
        nextauth: string[];
    }>;
};

function syncNextAuthUrlForRequest(req: NextRequest) {
    if (process.env.NODE_ENV !== 'development') return;
    const url = new URL(req.url);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return;
    process.env.NEXTAUTH_URL = url.origin;
}

function handler(req: NextRequest, context: NextAuthContext) {
    syncNextAuthUrlForRequest(req);
    return NextAuth(req, context, authOptions);
}

export { handler as GET, handler as POST };
