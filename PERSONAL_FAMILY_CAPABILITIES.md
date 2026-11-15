# Personal and family capability audit

Updated November 14, 2026 for the controlled tester release.

Personal and family functionality is implemented with the security changes below. Communities remain available with `npm run dev`, and are blocked by the production build in navigation, modals, pages, metadata, and API handlers. Disabled community controls are grey and explain that communities are coming later.

**Status key:** **Local** means implemented and checked through source review, compilation and relevant offline regressions; it is not a claim of a real browser/database end-to-end test. **Live check** means the code is implemented but its external provider or deployed database behavior still needs a controlled smoke test. **Future** means no complete active capability exists. No live accounts, database records, storage files, or email were changed during verification.

## Login and account

| Capability | Status | Behavior and checks |
| --- | --- | --- |
| Register with email and password | Live check | Server hashes passwords; a verification email is required. Client-supplied hashes are rejected. |
| Verify email ownership | Live check | One-use hashed token, one-hour expiry, and mailbox owner chooses the password. Needs actual email delivery test. |
| Existing local account migration | Live check | Old sessions expire. `/verify-email` recovers the same account ID and family roles after mailbox verification. |
| Password sign-in | Local | Requires verified account, bounded bcrypt parameters, and shared account/IP limits. |
| Google sign-in for a new account | Live check | Requires a verified Google email; test the deployed OAuth callback. |
| Link Google to a verified local account | Live check | Sign in locally first and use Link Google in settings. Email alone cannot link another person's local account. |
| Google claim of an unverified account | Local | Prior local password and sessions are revoked; the claimant must prove the matching verified Google identity. |
| Sign out | Local | NextAuth sign-out plus immediate client store reset. |
| Expired session and switching accounts | Local | Stale content is hidden, seven client stores are reset, and prior account data is discarded. |
| Password recovery or Google-only password setup | Live check | Email recovery at `/verify-email` preserves account ID and data. Required before password-confirmed family actions for Google-only users. |
| Change password | Local | Current-password confirmation; server hashing and session revocation; sign in again afterward. |
| Change email | Live check | Old address remains active until the new mailbox confirms. Confirmation revokes old sessions. |
| Change display name | Local | Safe profile allowlist; updates current session/store and active family member names by immutable ID. |
| Edit biography or profile image from the settings UI | Future | Production shows grey Edit biography and Change avatar controls with coming-later messaging. Development keeps its existing UI. Safe backend profile fields exist, but a full biography/avatar editor is not implemented. |
| Close personal account | Local | Password plus exact DELETE confirmation; revokes sessions/tokens immediately, detaches active membership and hides profile/recipes. A sole connected family admin must transfer administration or archive the family first. |
| Recover a closed account | Live check | Fresh mailbox token and new password, before the original 30-day deadline only. Preserves ID and remaining recipe ownership. No automatic family rejoin. Closed/purging email addresses remain reserved until purge; Google cannot reactivate them. |
| Transfer selected family recipes before deletion | Local | Creator offers an already-linked recipe to a chosen connected Admin of that family; the recipient explicitly accepts. Seven-day expiry, password confirmation, fresh role/ownership/privacy/content checks and exclusive image transfer. Accepted transfers remain with the new owner after source recovery/purge. |
| Account deletion recipe policy | Local | Every recipe still owned at purge time is designated for deletion. Delete unwanted recipes normally or complete selected transfers before the deadline. Pending offers never prevent deletion. No new ownerless recipe retention. |
| Permanent account purge after 30 days | Live check | Secured daily scheduled cleanup with bounded resumable batches. Deletes remaining owned recipes/references and verified unreferenced files before identity removal. Preserves accepted transfers. Needs deployed CRON_SECRET, schedule/index verification and controlled storage test. |
| Application maintenance admin | Local | Requires verified immutable `ADMIN_USER_ID`; the old admin-email fallback cannot grant privileges. |

## Personal recipes

| Capability | Status | Behavior and checks |
| --- | --- | --- |
| Create a personal recipe | Local | Validated name, description, ingredients, steps, tags, type, time and privacy; immutable creator ID comes from the session. |
| Keep every created recipe in the creator's collection | Local | New creation updates the creator's IDs; My Recipes also queries canonical `creatorID`, so an older missing ID does not hide an owned recipe. |
| Distinguish personal and family origins | Local | Cards and filters show Created personally or Created for family. Clients cannot assign origin, ownership or counters. |
| View recipe details | Local | Public recipes are readable; private recipes require creator, explicit immutable viewer, or active connected family access. |
| Private recipe metadata | Local | Unauthorized records get generic metadata instead of private names and descriptions. |
| Edit a recipe | Local | Creator only, including when opened from a family. Shared readers cannot edit the original. |
| Update ingredients, steps, tags and cooking details | Local | The same server validation is used by REST and server actions; invalid or oversized fields are rejected. |
| Add or replace recipe photo | Live check | Requires a verified upload owned by the creator. Needs an actual UploadThing upload/callback test. |
| Delete a recipe | Local | Creator only. Shared links, personal saved/favorite references, and eligible image references are cleaned up. |
| Bulk delete personal recipes | Local | Only owned recipes can be selected and deleted; saved recipes belonging to others are not offered as deletable. |
| View My Recipes | Local | Includes owned, saved and favorite recipes after fresh visibility checks. Stale IDs do not grant access. |
| Search, sort and paginate personal recipes | Local | Existing controls remain active; personal/family-origin filters were added. |
| Favorite or unfavorite | Local | Authorized recipe access when adding; shared rate limit and guarded counters. Bookmark/counter updates commit together and serialize against closure/purge. |
| Save or unsave a family or public recipe to My Recipes | Local | Saves a reference/bookmark, keeps the original creator, and follows updates to the same recipe. Account state and counters are checked transactionally. |
| Retain saved private access after removal from family or revoked sharing | Blocked | Saving is not a permission grant. Private contents disappear when authorization is removed. |
| Make a private recipe public or change explicit viewers | Local | Creator only. Changes advance a server-owned sharing version used by recovery protections. |
| Share privately with another verified user | Local | The viewer input is bound to the form. Emails resolve to verified immutable account IDs; fake viewer IDs are rejected. |
| Reuse an old email address to inherit private access | Blocked | Email-only legacy viewer grants no longer authorize reads. Owners must reconfirm old shares in the editor. |
| Independent copy or clone of someone else's recipe | Future | Production recipe details show a grey Make an editable copy control with coming-later messaging. Saving still bookmarks the original. |
| Ratings and comments | Future | Existing display/count fields remain, but there is no complete personal/family composer and submission workflow. |
| Print, PDF export, import, meal planning or shopping lists | Future | Production shows grey Print recipe and Export recipe controls on recipe details and Import recipes on My Recipes. These planned tools do not submit or navigate. Copying the ingredient checklist remains available. Meal planning has no complete workflow. |

## Family setup and membership

| Capability | Status | Behavior and checks |
| --- | --- | --- |
| Create a family | Local | Verified user only; one active family per user; creator becomes a connected Admin. Family and user updates commit together. |
| Set family name and heritage at creation | Local | Bounded name and heritage fields; arbitrary roles or members cannot be submitted during creation. |
| View family dashboard, recipes, members, settings and stats | Local | Every page requires canonical connected membership by immutable ID, including metadata. Archived families are excluded. |
| View another family's private dashboard by changing URL or profile data | Blocked | Relationship fields cannot be edited through ordinary profile updates; canonical membership is rechecked. |
| Invite members with Guest, Member or Admin role | Live check | Connected Admin only, bounded batches and rate limits. Stored server-authorized invitations define the role. Needs actual mail delivery test. |
| Resend an invitation | Live check | Reissuing replaces the old token. Failed mail delivery is reported; verified recipients can still use their profile inbox. |
| Accept a family invitation | Local | Verified matching recipient, current inviter Admin status, active family, session version and one-use token all checked transactionally. |
| Join a second active family | Blocked | Leave the existing family before accepting or recovering another family. |
| Decline an invitation | Local | Only the verified invited account can decline; pending membership is removed. |
| Mark invitations read or unread | Local | Only the verified recipient's tokens can be updated. Production excludes community invitations. |
| Expired or legacy insecure invitations | Blocked | Expired tokens fail. Older family invites without trusted inviter provenance must be resent by an Admin. |
| View family member profiles | Local | Public profile data is limited; family emails and same-family information require connected membership on both sides. |
| Rename family | Local | Working form with current password; Admin only. The prior button had no usable inputs. |
| Promote or demote members | Local | Admin plus password; role allowlist; at least one connected Admin must remain. Pending invitation roles are updated in the same transaction. |
| Remove family members or pending invitees | Local | Admin plus password; cannot remove the last connected Admin. User relationships and invitations are cleaned up together. |
| Leave family | Local | Connected members may leave; a last connected Admin must transfer administration or archive the family first. |
| Guest role | Local | Read access only for family operations; creation, addition and removal controls match server permissions. Personal recipe creation remains available. |

## Family recipes and recovery

| Capability | Status | Behavior and checks |
| --- | --- | --- |
| Create from the family recipe screen | Local | Connected Member/Admin only. Creates one recipe, owned by its creator, linked to that family, and marked with family origin. |
| Add an existing personal recipe to the family | Local | Connected Member/Admin only; private recipes require the creator's explicit action. No ownership transfer. |
| Add a public recipe to the family | Local | Connected Member/Admin may add a public reference; a concurrent privacy change is checked transactionally. |
| Share a private personal recipe with the family | Local | Explicit creator sharing grants active connected family members access consistently across detail and collection pages. |
| Reshare another person's private recipe to a different family | Blocked | Being an explicit viewer does not permit reshare. |
| Save a family recipe to personal My Recipes | Local | Use Save to my recipes on its detail page. It remains a reference owned by the original creator. |
| Edit a family recipe | Local | Creator edits the same record; authorized family readers see the update. |
| Delete a family recipe permanently | Local | Creator only. Removes the recipe and its references; Admin status alone does not transfer content ownership. |
| Remove a recipe from the family collection | Local | Family Admin only. Unlinks the family reference and preserves the creator's recipe. |
| Search, sort, filter and paginate family recipes | Local | Existing controls remain active. UI loading and ownership selection bugs were corrected. |
| Archive or delete family | Local | Any connected Admin may confirm password and type the family name. Everyone is detached; pending invitations are cancelled. |
| Preserve recipes after family deletion | Local | Every affected recipe stays with its creator. Missing legacy references in the creator's collection are backfilled, and family-origin recipes become personal. |
| Keep family data for recovery | Live check | Archive keeps family details, member snapshot and recipe links for 30 days. MongoDB TTL index declares automatic cleanup; verify indexes in deployment. |
| Recover family within 30 days | Local | `/family/recovery`; former connected Admin plus password/name confirmation; family and user updates commit together. |
| Members who joined another family during retention | Local | Recovery does not move them away from their new family; their private recipe links are not silently restored. |
| Privacy changes while family is archived | Local | Changed sharing versions prevent automatic private reshare. The owner can deliberately share again afterward. |
| Recover after 30 days | Blocked | Deadline is checked even before background TTL cleanup. Personal recipes continue to exist. |

## Dashboards and supporting features

| Capability | Status | Behavior and checks |
| --- | --- | --- |
| Personal dashboard overview and stats | Local | Own recipe counts use creator IDs; favorites are visibility-filtered; community data is omitted in production. |
| Personal recent activity and account history | Local | Existing recipe/review history display remains; broken recipe navigation targets were corrected. This is not a complete security audit log. |
| Profile inbox | Local | Recipient-scoped family invitations and immutable-user support messages. Community items are omitted in production. |
| Family dashboard and stats | Local | Recipe, connected-member/admin and heritage counts; authenticated family boundary. |
| Family activity feed | Future | The UI explicitly says Coming soon; no durable family activity feed is implemented. |
| Support or bug inquiries | Local | Verified account, bounded message fields, private immutable-user ownership; maintenance admin may reply or handle. |
| Upload maintenance admin | Live check | Immutable app-admin role and verified file ownership; actual provider scan/deletion requires a controlled test. |
| Mobile forms, drawer behavior and visual layout | Live check | Compilation and source checks passed; a real browser/device walkthrough is still required. |
| Communities and community posts | Production blocked | Grey entry points show Communities are coming later. Direct pages, metadata, APIs and modal actions are denied; development remains available. |

## Before inviting the tester

1. Deploy using Node 22.23.5 or a newer patched Node 22 release and a MongoDB replica set/Atlas deployment that supports transactions. This work has not been deployed automatically.
2. Verify `MONGODB_URI`, `NEXTAUTH_SECRET`, canonical HTTPS `NEXTAUTH_URL`, `RESEND_API_KEY`, verified-domain `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `UPLOADTHING_TOKEN` in the deployed environment. Add a random `CRON_SECRET` of at least 32 characters and verify the daily account-purge schedule after deployment. Configure `ADMIN_USER_ID` only for the maintenance account; normal family admins do not need it.
3. Ensure database indexes exist for unique emails, one-use verification token lookup, persistent rate-bucket expiry, upload keys/ownership, partial unique pending recipe transfers, account status/deadline lookup, and `Family.restoreUntil` TTL expiry. Users must not have a TTL index. The Mongoose schemas declare indexes; existing production index policy may require an explicit reviewed migration.
4. Existing local users use `/verify-email` to retain their original account and family roles. Resend old family invitations and reconfirm any legacy email-only private viewers. Existing images can remain unchanged, but ownership-less legacy files require trusted reconciliation before new attachment or automated deletion.
5. Perform a controlled two-user smoke test in the deployed tester environment: email signup/verification, Google login/linking, upload and image replacement, Admin invitation/acceptance, private family sharing, save-to-personal, creator edit/delete, Member/Guest denials, family archive and immediate recovery. Also test explicit transfer acceptance, account closure/session revocation, same-ID recovery, and cleanup against disposable due accounts. No provider credentials or live data were exercised by the offline suite.

Account cleanup runs after the deadline on the next scheduled pass, with later passes for unfinished batches/provider retries. See the [README account lifecycle notes](README.md#personal-and-family-tester-release) for limits, monitoring and manual authenticated retries. Legacy files shared with other content become `retained` tombstones rather than breaking other accounts; unknown untracked assets require trusted reconciliation. Accepted-transfer receipts keep opaque IDs as consent evidence. Recovering an account does not automatically restore active membership; an eligible former Admin may still explicitly recover a separately archived family.

## Verification performed

All **180 isolated regressions passed** through `npm run test:security`. They use synthetic users/models and mocked providers and exercise identity, session revocation, credential boundaries, invitations, role changes, private access, upload ownership, quota checks, family archive/recovery, recoverable account closure, accepting recipe transfers, deadline cleanup and provider retries, late upload callbacks, client account transitions, production/development community gating, and production-only unfinished-feature notices.

The final production build passed, including lint, TypeScript and all 54 static generation steps. `npm run test:production` passed against the built localhost server: public pages, anonymous personal/family page redirects and API denials, cross-origin rejection, inert invitation test route, account-closure receipt and transfer/purge endpoint denials, all 13 blocked community/post API methods, direct community-page denial, provider discovery, security headers, disabled public source maps and absence of unsafe legacy actions. Next.js streaming redirects were checked as redirects rather than misclassified as data-bearing HTTP 200 responses.

Run `npm run build` before `npm run test:production`. The smoke server binds only to localhost, overrides the database URI with an unused local port, and stops afterward. External-provider and real-device checks remain the Live check items above.
