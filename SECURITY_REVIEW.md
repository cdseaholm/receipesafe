# RecipeSafe application security review

Reviewed November 14, 2026 against the current working tree, including the dependency updates already in progress.

The initial review identified one critical and multiple high severity authorization, privacy, and authentication findings. The findings below describe that original snapshot.

## Personal and family follow-up implementation

The follow-up fixes the personal/family paths: the test invitation route is inert,
unsafe legacy actions are retired, account updates allowlist profile fields, client
payloads exclude credentials, sessions use immutable verified IDs with revocation,
passwords are hashed only on the server, uploads enforce ownership, and recipe and
family reads share authorization checks. Family mutations and archive/recovery use
transactions. Any connected family Admin can archive for 30 days while preserving
the creators' recipes, with protected recovery at `/family/recovery`.

Account closure now revokes sessions and deactivates for 30 days while keeping
the same identity and recipe ownership. Closed profiles/recipes are hidden;
fresh email recovery is allowed only before the original deadline. Explicit,
accepted family-admin transfers move ownership transactionally, including only
exclusively verified images. Scheduled cleanup deletes still-owned recipes and
their references before removing identity; failures remain locked for retry.
Recipe edits/deletes/bookmarks serialize against closure and transfers to protect
ownership and counters. The last connected family-admin safeguard remains in
place. Deployment still requires `CRON_SECRET`, schedule/index verification and
controlled provider checks; the local tests never purge a real account.

Community capabilities are blocked in production at pages, metadata, APIs,
middleware and UI entry points. Development community user/password payloads are
sanitized, but the private community post ACL finding remains development-only
work before communities can be released. Existing development email dependency
findings remain separate from the application changes.

See [the current capability audit](PERSONAL_FAMILY_CAPABILITIES.md) for the exact
feature list, implementation limits, migration steps and required provider checks.

## Original review scope

This review covers source code, the current production build, offline checks using synthetic users and mocked services, local HTTP headers, and dependency audits. It does not establish whether any issue has been exploited. Production infrastructure, live database contents, deployment access controls, and provider dashboards were not inspected. No real account changes, uploads, email sends, or database connections were performed. Application behavior was left unchanged.

## Findings by priority

| ID | Severity | Finding |
| --- | --- | --- |
| F01 | Critical | Unauthenticated test endpoint creates privileged family invitations |
| F02 | High | Legacy invite action changes another user's family |
| F03 | High | Profile action accepts security relationships that expose private data |
| F04 | High | Community client payloads expose user password hashes |
| F05 | High | Private community posts bypass authentication and membership checks |
| F06 | High | Collection pages disclose private and revoked recipes |
| F07 | High | Anonymous callers pass upload authorization |
| F08 | High | Any authenticated user can delete another user's uploaded images |
| F09 | High | Unverified email identities permit account pre-hijacking and conditional admin access |
| F10 | High | Old sessions can become sessions for different accounts after email reuse |
| F11 | High | Client-supplied password hashes control synchronous bcrypt work |
| F12 | Moderate | Family members can invoke an operation restricted to admins in the UI |
| F13 | Moderate | Discoverable community records expose shared-password hashes |

Severity reflects the affected data and required access. F09 has critical impact if the configured administrator email is not already registered; existing duplicate checks prevent simply registering over an existing admin account.

## Critical invitation creation

### F01 Unauthenticated test endpoint creates privileged family invitations

**Locations:** [test invitation handler](app/api/invite/test/route.ts#L59), [caller-selected permission](app/api/invite/test/route.ts#L38), [family update](app/api/invite/test/route.ts#L134), [invitation acceptance](lib/invite-utils.ts#L103).

The POST handler included in the production build uses a hardcoded sender instead of a session or family-admin check. It accepts a family ID and requested member permissions from the request, creates a valid invitation, sends it through Resend, and appends a pending family member. Normal acceptance preserves that pending member's permission.

A caller who knows a family ID can invite an address they control as an Admin. A family ID is a record identifier, not an authorization credential. This permits unauthorized family administration and access to private family data. Invitation creation also occurs before email configuration checks, so a mail setup failure does not prevent creation of an invitation that can appear in the recipient's profile inbox; without the pending member update, acceptance defaults to Member.

**Fix:** Remove this production route. Keep test fixtures outside routable application directories. Route every invitation creation operation through a shared authenticated family-admin check and a server-side permission allowlist. Review requests to this endpoint and unexpected pending invitations or family-admin additions if this code has been deployed.

**Evidence:** Static verification of invitation creation, permission propagation, and the existing acceptance function; the route is included in the current production build. No real invitation was created.

## Authorization and sensitive data

### F02 Legacy invite action changes another user's family

**Location:** [AcceptInvite](utils/server-actions/user/misc.ts#L9).

The action checks that some user is signed in, then loads the caller-supplied user ID and writes the caller-supplied family ID. It does not require that the target user is the caller, that a valid invitation exists, or that the destination family exists. An authenticated user can corrupt another account's family relationship. The action remains exported in the current built server-action manifest.

**Fix:** Remove this legacy action and its exports, or derive the user from the session and require the validated, email-bound invitation flow. Treat each server action as an independent endpoint with its own authorization, as described in the [Next.js security guidance](https://nextjs.org/docs/app/guides/data-security#authentication-and-authorization).

**Evidence:** Offline execution with an attacker session changed a different synthetic user's family ID.

### F03 Profile action accepts security relationships that expose private data

**Locations:** [UpdateUser](utils/server-actions/user/update.ts#L37), [profile data queries](app/(content)/u/profile/page.tsx#L60), [profile client props](app/(content)/u/profile/page.tsx#L127).

Although UpdateUser verifies ownership of the account being edited, it accepts `userFamilyID`, recipe ID arrays, `communityIDs`, and `password` from the client. The profile page then trusts those relationships to fetch a family, favorite recipes, and communities without checking actual membership or recipe viewing rights. Comparing the returned family ID with the same writable user field does not establish membership.

An authenticated user can assign identifiers of another family's or community's records to their own profile and receive private family member emails, private recipe contents, and hidden community data. This action also remains in the built server-action manifest.

**Fix:** Restrict ordinary profile updates to explicitly validated profile fields. Change passwords and relationships through dedicated authorized operations. Independently authorize every fetched family, recipe, and community before passing it to a client component.

**Evidence:** Offline execution of the actual profile page with synthetic relationships returned private family, recipe, and hidden community records to a user absent from their membership and viewer lists.

### F04 Community client payloads expose user password hashes

**Locations:** [full user queries](app/(content)/communities/[id]/page.tsx#L90), [serialization and client props](app/(content)/communities/[id]/page.tsx#L108), [user schema](models/user.ts#L17), [user API response](app/api/user/get/route.ts#L38).

Community pages load full creator, admin, and member User documents and pass them to a client component. An authenticated viewer of a public community can receive other users' password hashes, email addresses, and any populated password-reset fields in the browser payload. User password/reset fields are not excluded by default, and `serializeDoc` only converts JSON; it does not remove sensitive fields.

The user API and registration responses also return complete user records, exposing the current user's credential fields. These are additional instances of the same unsafe response pattern.

**Fix:** Introduce explicit public-user and current-user response objects that allowlist necessary fields. Exclude password/reset fields at the schema/query layer by default, explicitly selecting password hashes only during verification. Cover all client props, APIs, and action return values. Changing schema defaults requires updating authentication queries at the same time.

**Evidence:** Static verification of the community server-to-client boundary and default schema fields; offline API execution confirmed credential fields remain in serialized responses.

### F05 Private community posts bypass authentication and membership checks

**Locations:** [post route](app/(content)/communities/posts/[id]/page.tsx#L42), [nested post route](app/(content)/communities/[id]/posts/[post_id]/page.tsx#L42), [post metadata](app/(content)/communities/posts/[id]/page.tsx#L19).

Both post pages permit a null session, fetch a post directly by ID, and send its contents to the client. The nested route checks the post's community ID but never checks the community privacy level or the viewer's membership. Anyone who obtains a private-community post ID can read it. Metadata generation also reads post names and content without authorization.

**Fix:** Resolve the owning community and apply the same community-viewing policy before reading or returning post contents. Reuse the authorized read in both rendering and metadata generation. Return a generic not-found response for unauthorized records.

**Evidence:** Static verification of both page handlers, metadata functions, and client components; no private production posts were requested.

### F06 Collection pages disclose private and revoked recipes

**Locations:** [profile favorites](app/(content)/u/profile/page.tsx#L68), [family recipe page](app/(content)/family/[famid]/recipes/page.tsx#L27), [recipe lookup helper](lib/data/recipes.ts#L17), [community recipe query](app/(content)/communities/[id]/page.tsx#L101).

The recipe detail page checks public status, authorship, or explicit viewers. Profile favorites, family recipe lists, and community recipe lists instead fetch complete recipes solely by stored IDs. A recipe that becomes private or loses an explicit viewer can remain readable through an old favorite or shared-collection reference. These pages send full recipe contents, rather than just a title or inaccessible link.

**Fix:** Centralize viewer-aware recipe queries and apply them at every client boundary, regardless of stored relationship IDs. Recheck access on each read and when privacy changes; remove stale shared references where appropriate.

**Evidence:** Offline execution of the actual profile and family recipe page functions returned another creator's private recipe with an empty viewer list in client props. The community query has the same missing filter.

## Uploads and storage

### F07 Anonymous callers pass upload authorization

**Location:** [upload authorization and middleware](app/api/uploadthing/core.ts#L7).

The auth helper always returns a hardcoded identity. The middleware never reads or verifies a session, so a cookie-free request passes application authorization. The per-file 4 MB limit does not prevent repeated anonymous uploads or storage quota abuse.

**Fix:** Resolve the authenticated user server-side, reject anonymous requests, enforce durable per-user limits, and persist upload ownership from the verified identity.

**Evidence:** Offline invocation of the actual middleware with a request containing no cookies returned an identity. No upload or provider request occurred.

### F08 Any authenticated user can delete another user's uploaded images

**Locations:** [DeleteUploadThingFiles](utils/server-actions/uploadthing/delete-files.ts#L47), [recipe image attachment](utils/server-actions/recipe/create.ts#L47), [image replacement and deletion](utils/server-actions/recipe/update.ts#L64).

The deletion action verifies only that a user exists, then passes arbitrary client-supplied keys to the application's storage API. Keys can be obtained from image URLs. Recipe creation and updates also accept arbitrary image keys; attaching another user's key to an attacker-owned recipe provides another deletion path during image replacement or recipe removal.

**Fix:** Store verified ownership when uploads complete. Resolve deletion targets from authorized server-side records, validate ownership when attaching images, and account for shared references before deleting a file. Removing only the direct action export would leave the recipe lifecycle path exposed.

**Evidence:** Offline execution with mocked authentication and storage allowed an authenticated synthetic user to request deletion of a different user's supplied key. Anonymous deletion was denied. The action is included in the current build. No storage files were deleted.

## Identity and authentication

### F09 Unverified email identities permit account pre-hijacking and conditional admin access

**Locations:** [registration action](utils/server-actions/user/create.ts#L36), [email change](app/api/user/edit/route.ts#L73), [Google account lookup](lib/auth/auth-options.ts#L17), [admin authorization](lib/admin.ts#L13).

Local registration and email changes do not verify ownership of an email address. Other authorization paths trust that email for invitations and application-admin status. If the configured admin address is not already registered, registering it and signing in with credentials grants application-admin status. An existing account cannot simply be overwritten because duplicate checks and the unique email index apply.

There is also an account pre-hijacking path: someone registers a future user's address with a known password, then the real user later signs in with verified Google credentials. The Google callback reuses the existing local record by email, preserving the other person's password and sessions. Google's verified email does not retroactively validate the origin of those local credentials.

**Fix:** Verify local email ownership before credentials login or email-based privileges. Require verification for address changes. Link providers through an authenticated, explicit process that cannot preserve an unverified party's access. Store admin privileges against an immutable user ID rather than an email string.

**Evidence:** Offline registration, credentials authorization, email-change, and admin-policy checks confirmed the conditional admin path. Google account reuse is verified in the callback code. The current production admin account's existence was not queried.

### F10 Old sessions can become sessions for different accounts after email reuse

**Location:** [JWT and session callbacks](lib/auth/auth-options.ts#L111).

Each JWT refresh looks up a user by mutable `token.email` and replaces `token.id` with that record's ID. When an address is freed by an email change or account deletion and a different account later registers it, the old still-valid token is rebound to that new account. Downstream authorization also resolves users by session email. A token can therefore outlive its original identity.

**Fix:** Bind sessions to an immutable user ID established at login. Reject deleted or missing identities instead of falling back to email. Check a server-side session version or revocation state, and invalidate prior sessions after sensitive identity or credential changes.

**Evidence:** Offline invocation of the actual JWT callback rebound an old token to a different synthetic account after email reuse. [NextAuth invokes this callback on session access](https://next-auth.js.org/configuration/callbacks#jwt-callback), as well as initial login.

### F11 Client-supplied password hashes control synchronous bcrypt work

**Locations:** [registration password assignment](app/api/register/route.ts#L49), [credential verification](lib/auth/auth-options.ts#L62), [synchronous comparator](utils/userHelpers/verifyPassword.ts#L4).

The public registration API stores `body.saltedPW` verbatim. Authentication later feeds that stored value into synchronous bcrypt verification. A client can supply a syntactically valid hash with an extremely expensive work factor, causing subsequent login attempts to consume excessive CPU and block the server worker. This bypasses the fixed hashing cost used by the newer registration action. The generic account update paths also accept password material directly.

**Fix:** Accept passwords over HTTPS and hash exclusively on the server with a controlled cost. Remove client hash assignment from all creation and update paths. Validate stored hash parameters before verification, add shared login/signup throttling, enforce input size limits, and move expensive verification off synchronous request handling where appropriate.

**Evidence:** Safe offline checks confirmed that a high-work-factor hash passes registration and reaches the comparator unchanged. The expensive computation itself was deliberately not executed.

## Additional authorization findings

### F12 Family members can invoke an operation restricted to admins in the UI

**Locations:** [RemoveRecipesFromFamily](utils/server-actions/recipe/family.ts#L58), [admin-only UI control](app/(content)/family/[famid]/components/recipes/family-recipes-search-bar.tsx#L27).

The UI offers bulk editing only to family admins, but the action checks only connected membership. A Guest or Member can invoke it directly to remove another member's linked recipes or empty the shared collection. The underlying recipe documents are not deleted.

**Fix:** Enforce `hasAdminPrivilege(member)` in the action, or define and implement an explicit creator-scoped unlink policy on the server.

**Evidence:** Static comparison of the action's membership check with the UI role restriction.

### F13 Discoverable community records expose shared-password hashes

**Locations:** [community listing](app/(content)/communities/page.tsx#L39), [listing API](app/api/community/get/route.ts#L32).

Full discoverable community records, including `communityPassword`, reach the anonymous listing page or authenticated nonmember API responses. Password-protected communities remain discoverable. Their bcrypt hashes allow offline password guessing without the join endpoint's checks.

**Fix:** Return an explicit listing object that excludes password hashes and unnecessary membership/request internals. Select the password field only in server-side password verification.

**Evidence:** Static verification of discoverability rules, unprojected queries, and client props.

## Configuration and dependency observations

- [next.config.mjs](next.config.mjs#L8) applies wildcard CORS globally. This alone does not establish credentialed cross-origin access because browsers restrict wildcard responses with credentials. Replace it with a deliberate per-endpoint policy.
- The locally built login response lacks CSP, frame restrictions, `X-Content-Type-Options`, and an explicit Referrer Policy. Review CSP compatibility with Mantine and framework scripts before enforcing it. Verify HTTPS/HSTS and edge headers in the real deployment; local HTTP responses do not establish hosting-provider behavior.
- [Production source maps](next.config.mjs#L31) are publicly served locally with source contents. Disable public maps or upload them privately to error monitoring. This exposes client source, not automatically server code or secrets.
- No credential pattern matched the scanned tracked source. Checking configured private environment values against built browser JS/maps found only the already-public support email address, not credential-valued matches. Git history and external secret stores were outside this review.
- The refreshed production dependency audit reports **8 findings: 5 low, 3 moderate, 0 high, 0 critical**. The full audit reports **20: 6 low, 11 moderate, 2 high, 1 critical**. The critical Next.js copy and high Sharp/preview-server findings belong to the development email preview stack. Keep that server private and handle its supported migration separately. Dependency audit counts do not include F01 through F13.
- Session cookies already use HttpOnly, SameSite Lax, and Secure in production. Normal invitation acceptance binds the invite email to the signed-in user, and family helpers check connected membership. Reuse these checks consistently; the bypasses above occur in alternate paths.

## Remediation and verification order

1. Remove the invitation test route and unsafe legacy action exports. Preserve and inspect relevant access logs and family membership/invitation records if they have been deployed.
2. Stop user credential and community password disclosure using response allowlists and appropriate projections. Determine whether credential exposure requires password resets and session revocation for affected users.
3. Add upload authentication and persistent ownership checks for upload, attachment, replacement, and deletion.
4. Bind sessions and roles to immutable identities, require email verification, and hash passwords only on the server with bounded work and shared rate limits.
5. Centralize family, community, post, and recipe authorization for every read and mutation, including list data and metadata. Enforce server-side roles for bulk operations.
6. Add regression coverage with two unrelated users, a family Guest/Member/Admin, public/private communities, revoked recipe viewers, reassigned emails, and forged file references. Unauthorized operations must fail before database writes, storage requests, or email sends.
7. Apply deployment hardening and finish the development email dependency migration after the application authorization fixes are tested.

