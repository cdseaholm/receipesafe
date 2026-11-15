# RecipeSafe

RecipeSafe is an early access Next.js app for keeping family recipes safe. It helps users save recipes, organize notes and ingredients, and build toward private family recipe sharing.

## Core Stack

- Next.js App Router
- React
- TypeScript
- MongoDB / Mongoose
- NextAuth
- Mantine
- Resend
- UploadThing
- Zustand

## Local Development

Use Node.js 22.23.5 (see `.nvmrc`) locally and Node 22.x in deployment. Older
Node 22 releases, including 22.9.0, cannot load the ES modules used by the
current Tailwind build tools. With nvm installed, run `nvm install 22.23.5` and
`nvm use 22.23.5` before installing dependencies.

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Use `.env.local` for local development and configure matching production values in Vercel.

```bash
MONGODB_URI=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
ADMIN_USER_ID=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

RESEND_API_KEY=
EMAIL_FROM=support@getrecipesafe.com

NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_INVITE_BASE_URL=http://localhost:3000
```

Production values should use the canonical domain:

```bash
NEXTAUTH_URL=https://www.getrecipesafe.com
NEXT_PUBLIC_BASE_URL=https://www.getrecipesafe.com
NEXT_PUBLIC_INVITE_BASE_URL=https://www.getrecipesafe.com
```

## Google OAuth

In Google Cloud Console, configure the OAuth client for a web application.

Authorized JavaScript origins:

```text
https://www.getrecipesafe.com
https://getrecipesafe.com
http://localhost:3000
```

Authorized redirect URIs:

```text
https://www.getrecipesafe.com/api/auth/callback/google
https://getrecipesafe.com/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

If `getrecipesafe.com` permanently redirects to `www.getrecipesafe.com`, the `www` callback is the canonical one. Keeping both listed is harmless and avoids redirect/callback surprises while DNS and Vercel settle.

Add the Google credentials to Vercel:

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## Resend Email

RecipeSafe sends invite email through Resend.

Checklist:

- Verify `getrecipesafe.com` in Resend.
- Confirm SPF/DKIM DNS checks are passing in Resend.
- Set `EMAIL_FROM=support@getrecipesafe.com` in Vercel.
- Redeploy after changing the environment variable.

Resend domain verification allows sending from `support@getrecipesafe.com`; it does not automatically create an inbox. To receive mail sent to `support@getrecipesafe.com`, configure email hosting or forwarding with the domain/DNS provider.

Common forwarding options:

- Registrar email forwarding, if offered
- Cloudflare Email Routing
- Google Workspace
- Microsoft 365
- ImprovMX

## Personal and Family Tester Release

See [the complete capability audit](PERSONAL_FAMILY_CAPABILITIES.md) for active
features, security behavior, migration notes, and the remaining live-provider checks.

Communities are enabled by `npm run dev` and disabled whenever `NODE_ENV` is
`production`. Production UI controls are grey with a coming-later message, and
community/post pages and APIs are blocked independently of the UI.

Local accounts must verify mailbox ownership through `/verify-email`. Existing
active accounts retain their ID and family roles when recovered there. Google-only users
can set a password through the same email recovery flow before password-confirmed
family administration. Application maintenance uses the immutable `ADMIN_USER_ID`,
not `ADMIN_USERNAME`.

Family deletion now archives the family for 30 days. Any connected family Admin
may confirm their password and type the family name. Members are detached and
invitations cancelled; recipes remain with their creators and family-origin recipes
become personal. Former admins can recover at `/family/recovery` without moving
members out of another family or undoing later recipe privacy changes.

MongoDB transactions and the declared TTL/unique indexes are required. Recovery
stops at the 30-day deadline; archive cleanup runs through the `restoreUntil` TTL
index. Verify this index exists in the deployed database.

Account closure uses a separate 30-day recovery model. Settings requires the
current password and exact `DELETE` confirmation. Closure revokes every session,
invalidates old recovery tokens, detaches active family/community membership, and
hides the profile and owned recipes. The account ID, email reservation, recipe
ownership and personal collections remain intact until the deadline. A fresh
email recovery link and new password restore the same account before that deadline;
recovery does not automatically rejoin a family. Existing authorized family archive
recovery remains available; otherwise request a new invitation. Google sign-in or
registering again cannot reactivate a closed account.

Settings includes **Family recipe transfers**: the creator may offer an already
shared recipe to a selected connected Admin of the same family. Ownership changes
only on explicit acceptance. Offers expire after seven days; pending offers do not
stop deletion. Content/privacy/membership changes invalidate acceptance. Accepted
transfers and their exclusive verified images remain with the new owner, including
if the original account is recovered or purged. Legacy/shared images or separate
step images must be removed or replaced before transfer.

The daily `/api/cron/account-purge` job in `vercel.json` runs at 03:00 UTC. Set a
random **`CRON_SECRET` of at least 32 characters** in production before deploying;
the endpoint rejects missing/weak secrets and requires `Authorization: Bearer`
with the configured value. [Vercel cron configuration and authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
apply only after deployment. For another host, schedule the same authenticated
GET endpoint. No scheduler was activated by this local work.

Recovery stops exactly at the original 30-day deadline. Physical cleanup starts
on the next scheduled run, processes at most five accounts, 100 owned recipes and
25 uploads per account per run, and resumes incomplete work on later runs. Failed
attempts rotate so they cannot starve other accounts. Monitor nonzero `failed` or
`pending` counts and 503 responses; Vercel does not immediately retry failures.
You can repeat the authenticated GET to drain the backlog. Each run also retries up to 25 rejected upload callbacks, including files whose original account has already been purged. The account remains
locked as `purging` until cleanup succeeds. Only recipes still canonically owned
by it are removed; accepted transfers survive. Dependent bookmarks, family archive
links, invitations, support inquiries and obsolete author data are cleaned up.

Only verified storage keys are deleted. Unknown legacy URLs require trusted
reconciliation. Files still referenced by another recipe, avatar or post are
marked `retained` for manual reconciliation; they retain only an opaque former
owner ID and grant nobody new access. Accepted-transfer receipts retain opaque
IDs as consent evidence. Check the upload ownership and transfer indexes in the
deployed database; user records deliberately have **no TTL index**, because
recipe/storage cleanup must finish before identity removal.

Run `npm run test:security`, `npm run build`, and `npm run test:production`.
The final local verification passed all 180 isolated regressions, the build, and the
production HTTP smoke checks. Provider delivery/callbacks and real-device checks
remain necessary in the deployed tester environment.

## Dependency Security Snapshot

The November 14, 2026 dependency update keeps the app on Next.js 15.5.28 with
matching lint configuration and bundle analyzer. Mongoose stays on version 8.
The lockfile includes compatible security fixes reviewed with
`npm audit fix --dry-run`; do not use `npm audit fix --force` as a shortcut.

Two overrides and one explicit image dependency need to be preserved:

- `effect` 3.20.0 fixes async context isolation while keeping UploadThing on
  version 7. Its pinned `@effect/platform` remains unchanged.
- The PostCSS override uses the direct PostCSS 8 dependency throughout the
  tree because Next.js still pins an older vulnerable copy.
- `sharp` 0.35.5 is explicitly installed for the app's image optimizer. This
  version is supported by Next.js 15.5.28 and fixes the reported native image
  library vulnerabilities. The email preview tool has its own older copy.

The production audit after these changes reports zero high or critical findings,
with eight remaining package findings from the UploadThing cookie helper and
email HTML-to-text dependencies. The full development audit still flags the
React Email 5 preview server's separate Next.js 16 installation as critical,
plus image, glob, and lint-tool dependencies. Do not expose the email preview
server publicly. These findings require separate upstream updates or a tested
React Email/Resend migration; forcing the newer renderer under Resend 4 breaks
its `renderAsync` API. Recheck the audit before deployment and after updates.

## Deployment Notes

- Production domain: `https://www.getrecipesafe.com`
- Non-www domain should redirect to the canonical www domain.
- Old Preserved Recipes domains should redirect path-for-path to RecipeSafe.
- Keep `NEXTAUTH_URL`, public base URL vars, and OAuth callback URLs aligned with the canonical domain.

## Launch Records

Keep records that show first public use of the RecipeSafe name:

- Domain purchase receipt from the registrar
- Vercel deployment logs
- Git commits showing the rebrand
- Screenshots of the live site
- First user/signup records
- Resend domain verification screenshots

The domain receipt usually lives in the registrar account where the domain was purchased, often under billing, orders, invoices, or receipts. Email confirmations from the registrar also count.
