# 6MD Discord bot feature specification

Status: agreed product scope with implementation proposals identified below.
Updated: 2026-10-04

## 1. Scope and ownership

The Discord bot is planned to target **.NET 10** and lives in a separate repository and deployment. The website provides its configuration UI, authoritative business data and rules, and administrative controls. The bot performs Discord actions and reports their results through the website API. It does not connect directly to the website database.

Every bot behavior setting belongs in the web configuration. The external exceptions are the website API URL/key, Discord API credentials/connection identity, and a Discord user ID for outage alerts. The alert recipient is stored locally alongside the connection settings so website failure cannot prevent recipient lookup. See [web configuration and integration](./web-configuration-and-integration.md).

This specification supersedes both deprecated documents listed in the [documentation index](./README.md). Older features such as automatic attendance compilation, Discord promotion approvals, and training-notification workflows are not added to this release merely because they appeared in those documents.

## 2. Reaction role menus

Admins create categories, each represented by a Discord role-menu message. Each category has a title, description, channel, and ordered entries containing an emoji, display label, and Discord role.

- Adding a reaction grants the corresponding configured role.
- Removing that reaction removes the corresponding role, even if the member already held it or staff also assigned it. For a role exposed in a reaction menu, reaction removal is an explicit removal request; no independent-grant exception applies.
- Admins can add, edit, remove, and reorder entries and update the existing published message.
- Provide a preview and explicit publish/update controls.
- Menus manage only their configured self-service roles; rank, staff, and default join roles must not accidentally become self-assignable.
- Reaction-menu roles never establish membership for honeypot classification, even though newcomers cannot see the role-selection channel.

The initial Games category uses these requested entries. Labels remain editable in the website; Discord role IDs must be selected during setup.

| Emoji | Requested label |
|---|---|
| 🧙‍♂️ | Leauge Of Legends |
| 🗺️ | Minecraft |
| 💣 | Arma Reforger |
| 🔫 | CSGO |
| 🍻 | Drink+Chill |
| 🎲 | JackBox |
| 🏌️‍♂️ | Golf It |
| 📺 | Media Events |
| 🚀 | Space Engineers |
| 🧟‍♂️ | Project Zomboid |
| 🤸 | Human Fall Flat |
| 🛩️ | Warthunder |
| 🧨 | Arma Antistasi |
| 🦠 | Dayz |
| 🗡️ | Enshrouded |
| 🪓 | Valhein |
| 🛻 | Squad |
| 🦀 | Crab Games |
| ⚔️ | Elden Ring |
| 🛡️ | Civ VI |

Each category supports multiple selections or one selection, configured in the web UI. Games defaults to multiple. In single-choice mode, selecting a new role replaces only the previous selection from that category.

Deleting an entry keeps existing member roles by default. Offer an explicit bulk-removal action with an affected-member preview. The affected-member preview defines the scope of explicit bulk removal. This is separate from a member removing a reaction, which removes the mapped role regardless of its original source. The menu editor never deletes the actual Discord role.

## 3. Join roles and welcome messages

### Automatic join roles

- Assign the web-configured default roles when a member joins.
- Retry failed assignments; after three failed attempts, record an unresolved failure visible to staff.
- Three attempts total: immediately, then after 10 seconds, then after another 30 seconds. These are the default web-configured delays; Discord-requested waits take precedence. After exhaustion, staff can explicitly retry.
- Preserve successful partial assignments and retry only what is missing.
- A honeypot ban cancels pending assignment work. Check cancellation again before a retry acts so an in-flight job cannot resume assignment after a ban.

Changes to default join roles apply to future joins by default. Applying changes to existing members requires an explicit admin action and an affected-member preview. Retaining an old default role does not establish membership; only the configured membership-role list does.

### Welcome messages

Send on joining, without waiting for verification or successful role assignment. The website configures the channel, template, recruiter role, recruitment lobby, rules channel, and guidebook URL. Provide preview and explicit test-send actions.

Example editable template:

> **From the 6MD recruitment team,**
> Hey {member}, welcome to **{server}**! Sit tight and {recruiter_role} will get to you soon to give you an introduction! Please feel free to reach out in {recruit_lobby} if you have any questions. For our guidebook click [Guidebook]({guidebook_url}). Our rules: {rules_channel}.

Render member, role, and channel placeholders as actual Discord references. The guidebook URL and all destinations are web settings, not hard-coded bot values. By default, send a welcome on every join, including returning members. Apply current default join roles and reconcile the linked website rank role and nickname for returning members.

## 4. Mission announcements and roster image

An ORBAT's admin view provides **Announce to Discord**. The admin previews the message, edits custom mission text, and selects the destination and mention target before publishing. The destination is prefilled from the **Default mission ping channel** in web configuration. Admins can override it for an individual ORBAT or reset it to the default before the first announcement is queued. Once queued, that announcement retains its channel so subsequent signup updates edit the same message; changing the configured default affects new announcements only. Initial publication is explicit; creating an ORBAT or running a reconciliation job must not automatically announce an unannounced operation.

An announcement includes:

- Editable mission text, optionally mentioning everyone or a selected role.
- Operation title, schedule, summary, and website link supplied by the website.
- The existing generated ORBAT image/layout, enhanced with signup occupancy.
- Buttons: **Sign up / Change slot**, **Cancel signup**, **Availability**, and **Open ORBAT**.

Reuse the generator in `app/orbats/[id]/opengraph-image.tsx`; do not replace the chosen layout with a separate textual full-roster design. The website generator now renders occupancy labels/counts and the web-configured empty, partial, and full colors. Uploading refreshed images to Discord remains the executor’s responsibility.

Assigned slots use a different color from available slots. Show occupancy counts for multi-capacity slots; proposed visual states are empty, partially filled, and full, with labels/counts so color is not the only distinction.

### Live updates

- Website and Discord signup additions, slot changes, cancellations, and administrative removals refresh the existing message and image.
- Availability or operation changes refresh affected public information without publishing personal note text.
- Preserve custom announcement text during automatic refreshes.
- Batch closely spaced updates and render the latest authoritative state.
- Refreshes do not repeat mentions or create another announcement.
- Track message references and show view-message, refresh, and explicit send-another-ping actions in administration.
- If a message is missing or cannot be edited, show the failure and an explicit recovery/repost action.
- Disable signup controls when the website says signup is unavailable. Apply operation-specific permissions to other controls rather than assuming all availability editing closes at the same time.

Full ORBAT cancellation is deferred. When implemented, it must update the announcement and disable unavailable interactions.

## 5. Signup and availability interactions

### Signup

Use a private button-based flow: choose squad, choose available slot, receive confirmation. Paginate where needed. Show an existing signup and allow changing or cancelling it.

- Resolve the invoking Discord account to its linked website user. If unlinked, provide the account-linking/sign-in URL; do not create shadow users.
- Use the same website records and domain operations for both interfaces.
- Enforce training, rank, capacity, deadlines, absence restrictions, ownership, and every other applicable website prerequisite.
- Ineligible slots cannot be selected; explain unmet requirements.
- Revalidate on submission. If a slot fills while the member chooses, explain the conflict and refresh choices.
- Slot changes must not discard the old signup before the replacement succeeds.
- Duplicate interactions must not create duplicate signups or effects.
- Old message buttons cannot bypass current website restrictions.

### Absence and availability notes

Expose the website's supported options and fields through a private Discord flow, including absence, uncertainty, late arrival, early departure, optional reasons, and edit/clear actions where supported.

The website is authoritative for supported statuses, minute requirements, cutoffs, prerequisite checks, and interaction with existing signups. Do not invent a Discord-only automatic cancellation rule or infer rules from the deprecated documentation. Verify current domain behavior before implementing the UI.

Personal note text must not be copied into public Discord announcements. This requirement does not change the website's existing note visibility policy.

## 6. Honeypot moderation

Admins configure the trap channel, established-member roles, default join roles, exempt roles/accounts, timeout duration, staff log destination, and evidence retention through the website.

### Classification

Evaluate the member's current roles when the honeypot is triggered and retain that role/configuration snapshot with the case.

| Priority | Member state | Result |
|---|---|---|
| 1 | Configured exemption | No punishment |
| 2 | Has a configured established-member role, excluding reaction-menu roles | Timeout |
| 3 | No configured established-member role or exemption, including default-only, reaction-only, unclassified-only, or no roles | Ban; cancel pending join-role assignment |

The initial established-member roles to select in the web configuration are **Regulars**, **Retired**, **Friend of Group**, and **Joint-operations**. Store their selected Discord role IDs; these names are setup guidance, not hard-coded name matching. Admins can change the configured list through the website.

An arbitrary cosmetic/integration role does not establish membership. Members without a configured membership role or exemption are banned on a honeypot trigger, including members whose join-role assignment is pending or failed. An established-member role selects timeout, not exemption from punishment.

Established-member and exemption rules take precedence over assignment failure. Prevent reaction roles from being selected as membership roles.

### Punishment and early release

- Honeypot timeouts default to 24 hours; configuration cannot select less than 24 hours and must also respect Discord's supported limits.
- Authorized admins may release a timeout early in the website, with an optional reason.
- Display member, trigger, expiry, punishment status, and release status.
- Record the releasing admin and timestamp; show success only after Discord confirms release.
- Track one moderation case per trigger with idempotent action processing; repeated delivery must not restart a released timeout.

### Cleanup and mandatory evidence

- Delete the triggering message and the member's messages across the server from the 30 minutes preceding the trigger.
- Anchor the window to the original trigger time; retries must not move it forward.
- Preserve evidence in restricted website-managed storage before deleting each message. Include available message content, author/channel/message IDs, timestamps, relevant attachments, role/configuration snapshot, punishment, cleanup outcomes, and early releases.
- Message links alone are insufficient evidence after deletion.
- Punishment should not wait for a lengthy cleanup scan. Evidence capture, deletion, and punishment have separately visible outcomes.
- If evidence capture fails, report the failure and retry; do not silently delete the sole copy of uncaptured evidence. Inaccessible, previously deleted, or unrecoverable messages must be recorded as coverage gaps.
- The bot cannot promise removal of messages it cannot access; show partial cleanup and retryable failures to staff.
- Retain evidence for at least 7 days, configurable to a longer duration or **Keep indefinitely**.
- Indefinite retention disables automatic evidence expiry. Proposed clock: each evidence item is retained from its capture time, so late-captured material is not immediately expired.
- Authorized admins can mark individual evidence items **Keep indefinitely**, independently of the global default. Global finite retention changes must not clear this mark.
- Provide **Delete**, **Restore**, and **Keep indefinitely** actions in the web UI. Both manual deletion and automatic retention expiry are soft deletions: hide the item from normal views and retain its content and attachments in a restricted recovery view for 7 days from deletion. No immediate permanent-delete action is included.
- Indefinite retention prevents automatic expiry but still permits explicit manual deletion, with the same 7-day recovery window.
- Audit deletion, restoration, and indefinite-retention changes with actor (admin or automation) and timestamp. Deleting evidence does not erase the moderation case, punishment history, or these audit records.
- Increasing global retention extends existing active evidence; reducing it affects newly captured evidence only. Switching from indefinite to finite leaves existing indefinitely retained evidence unchanged. See the integration document for deletion/retention precedence and recovery behavior.
- Apply evidence-specific retention to attachment copies as well as message content. Do not allow an unrelated general audit-pruning job to expire this evidence early.

## 7. Rank roles and two-way name synchronization

The website rank is authoritative. Configure its Discord role mapping and nickname prefix format in the web admin.

- On registration/account linking, member rejoin, and website rank change, reconcile the linked member's role and nickname.
- Add the intended rank role before removing obsolete managed rank roles; preserve unrelated roles.
- Missing mappings or API failures must not remove all rank roles.
- A nickname edit or manual Discord role change cannot promote a website user.
- Report permissions/hierarchy failures and allow retries.

### Shared base name

| Change | Website name | Discord server nickname |
|---|---|---|
| Private registered as Alex | Alex | `[Pvt] Alex` |
| Website name changed to Raven | Raven | `[Pvt] Raven` |
| Discord nickname changed to Falcon | Falcon | `[Pvt] Falcon` |
| Promoted to Corporal | Falcon | `[Cpl] Falcon` |

- Members may change the base name from either side; moderator nickname corrections also synchronize to the website.
- The rank prefix exists only in the server nickname, not in the stored website base name or global Discord account name.
- Apply website name validation. Reject invalid names with an actionable explanation and restore the accepted formatted nickname where possible.
- Strip only recognized managed prefixes, preserving unrelated name content.
- Restore the correct prefix if it is removed or edited; never interpret an edited prefix as a rank change.
- Ignore the bot's own synchronization echoes and prevent stale queued updates from overwriting newer accepted names.
- Handle Discord nickname-length limits without truncating the stored website name or importing the bot's shortened rendering as a new base name.
- Audit old/new names and the moderator where identifiable. Do not label an unknown actor as the member.
- No name-change lock is included; members can change their name again after a moderator correction.

Accepted defaults: the website name wins at initial account linking; clearing a server nickname restores the existing website name with its rank prefix. Version conflicts refresh current state rather than silently overwriting it.

## 8. Web administration and operations

Dedicated `discord:*` permission keys control status, configuration, announcements, retries, moderation review, timeout release, and evidence viewing/deletion/restoration/retention. All default to **0** (denied); positive grants enable their specific capabilities, and `system:super_admin > 0` overrides them. Enforce checks server-side using the [permission matrix](./web-configuration-and-integration.md#7-access-evidence-and-discord-feasibility).

- Organize configuration around overview, roles, welcome, reaction menus, announcements, moderation/evidence, rank/name sync, and operational settings.
- Populate channel and role pickers from bot-reported Discord metadata, showing freshness and permission problems.
- Show saved configuration revision separately from the revision actually applied by the bot.
- Display connection/last-contact status, pending work, failures, and retry controls.
- Audit configuration changes and administrative actions.
- Provide previews and explicit test-send controls. Previews must not send messages or mentions.
- All feature toggles, schedules, retry policies, template values, colors, channels, roles, and runtime behavior settings live in the web configuration, with product minimums enforced server-side.

## 9. Confirmed defaults, deferred work, and remaining decisions

The following product decisions are settled:

| Topic | Confirmed behavior |
|---|---|
| Honeypot membership | Select membership roles in the web UI, initially Regulars, Retired, Friend of Group, and Joint-operations. Match configured Discord role IDs, not hard-coded names. |
| Unclassified or missing roles | On a honeypot trigger, timeout members with a configured membership role; ban those without one, including unclassified-role and failed/pending join-role cases. Exemptions take priority; reaction roles never establish membership. A ban cancels pending join-role assignments. |
| Returning members | Welcome on every join by default; apply current default roles and reconcile linked website rank roles and nicknames. |
| Deleted reaction-menu entries | Keep existing roles by default. Offer explicit removal with an affected-member preview. Removing a reaction removes its mapped role regardless of the original grant source. Never delete the Discord role itself. |
| Selection mode | Configure each category for multiple or single selection. Games defaults to multiple; single selection replaces only the previous selection in that category. |
| Initial or cleared nickname | Website name wins at account linking. Clearing a Discord nickname restores the website base name with its rank prefix. |
| Join-role retries | Three attempts total: immediately, after 10 seconds, then after another 30 seconds by default. Delays are web-configured and honor Discord-requested waits. Log exhaustion and allow explicit manual retry. |
| Changed default join roles | Affect future joins by default. Updating existing members requires an explicit action with an affected-member preview; old default roles do not establish membership. |

Deferred features are **mod preset posting** and **full ORBAT cancellation**. They must not appear usable before website support exists.

The operational defaults are also settled:

- Verify configuration at startup, on change notifications, and every 60 seconds; use verified cached configuration for up to 15 minutes without website contact, then pause new automated moderation, role, and nickname changes.
- Notify the locally configured Discord user of website/configuration outages; report recovery without sending repeated alerts for every failed request.
- General transient retries use six attempts total: immediate, then waits of 5 seconds, 15 seconds, 1 minute, 5 minutes, and 15 minutes, with jitter and server-requested waits taking precedence. Join-role retries remain separate.
- Retention increases can extend existing evidence; decreases apply only to new evidence. Individual evidence can be retained indefinitely, or manually deleted even when marked indefinite. Both manual and automatic deletion provide a 7-day recovery window.

Detailed recovery and evidence lifecycle requirements are in [web configuration and integration](./web-configuration-and-integration.md).

The planned runtime is .NET 10. The Discord library, repository name, hosting, and operational storage technology remain unselected. Current website API paths are documented in the [implementation mapping](../api/batches/discord-admin.md); bot execution is still separate work. Dedicated permission keys are defined in section 8 and the integration permission matrix. Finite evidence restoration grants at least seven additional active days, as documented in the integration contract. Do not import assumptions from the deprecated documents.

## 10. Acceptance criteria

1. All behavioral settings can be managed in the website without editing bot-local configuration or redeploying for ordinary setting changes.
2. Join-role assignment retries terminate after the agreed attempt limit; honeypot bans cancel queued/in-flight follow-up assignment work.
3. Welcome messages are triggered on join and render configured references correctly.
4. Reaction add/remove updates only the configured role; reaction roles cannot establish moderation membership.
5. Announcements require explicit admin publication, reuse the existing image layout, and update occupancy without duplicate messages or pings.
6. Website and Discord signup/availability operations enforce identical domain rules, including concurrent slot contention and stale interactions.
7. Honeypot classification uses the web-configured membership-role IDs and exemptions: members are timed out, exempt accounts are skipped, and all other triggering accounts are banned, including unclassified-role and assignment-failure cases.
8. Timeout configuration cannot fall below 24 hours; authorized early release is audited and confirmed by Discord.
9. Cleanup uses the original 30-minute window and preserves evidence with visible partial failures.
10. Evidence survives for the configured period of at least 7 days, or indefinitely, including attachments.
11. Rank and name changes converge without duplicate prefixes, echo loops, unintended rank changes, or corruption of the website base name.
12. Restart/replay does not repeat punishments, undo releases, resend pings, or lose tracked failures.

13. Website outages alert the locally configured Discord user, stale configuration pauses the specified actions, and recovery revalidates pending work.
14. Both manual and automatic evidence deletion preserve content and attachments for 7 days of recovery. Indefinitely retained evidence never automatically expires but can be manually deleted and restored.
15. Removing a reaction removes its mapped role even if it was originally assigned by staff; deleting the menu entry itself keeps member roles unless explicit bulk removal is requested.
16. Bot administration and evidence operations require the applicable dedicated permissions or the superadmin override; unauthorized requests are rejected server-side.

## 11. Website support delivered

Website APIs and administration now cover configuration history/diagnostics, durable configuration and member events, join-operation reporting/retry, persisted menu references, reviewed bulk role actions, announcement render acknowledgements/recovery, member signup/availability/name adapters, and moderation/evidence lifecycle including cleanup after timeout release. Exact contracts and deployment migrations are in the [current API mapping](../api/batches/discord-admin.md). These features still require the separate Discord executor to perform gateway interactions and Discord effects. The acceptance criteria above remain end-to-end requirements, not a claim that the unbuilt bot has passed them.
