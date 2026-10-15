# Mukando Manager — all 9 phases, with Firebase

Plain HTML, CSS and JavaScript ES modules. No framework or build step. The supplied Firebase project is `scanpoly-f2834`. This system records club information; it does not move money.

**Status:** every phase in `PLAN.md` is built: members, rules, rotation, payments, payouts, reminders, reports, users, backup and audit trail, My account and the polished dashboard. Publish the current database rules before using Phase 5 onwards: paste `PUBLISH-PHASE-9.sh` into Google Cloud Shell (details under *Phases 5 to 9*).

## Run

Run `python3 -m http.server 8001 --bind 127.0.0.1` from this folder and open http://localhost:8001. Internet access is required to load Firebase and access cloud data. Use localhost or HTTPS, not a file URL.

## Firebase console setup (required before login)

1. Open https://console.firebase.google.com/project/scanpoly-f2834 and select **Authentication**. Enable the **Email/Password** sign-in provider.
2. Under Authentication → Users, add an admin user with your email and a strong password. Copy its **UID**. The old local `admin / admin123` account is no longer used.
3. Open **Realtime Database**. Use the database URL supplied in `js/firebase.js`. Create this profile under `mukando/users/YOUR_AUTH_UID`, replacing both UID placeholders with the UID from Authentication:

```json
{
  "id": "YOUR_AUTH_UID",
  "username": "admin",
  "role": "admin",
  "active": true,
  "mustChangePassword": false
}
```

4. Publish the rules. The easy way is `PUBLISH-PHASE-9.sh` in Cloud Shell (see below). Or, under Realtime Database → Rules, merge the `mukando` section from `database.rules.json` into your existing rules and publish. If this is a new database, you can use the whole file. The supplied file denies access outside the Mukando namespace. **Do not replace existing rules blindly if this Firebase project hosts another app.** Remove any broad root-level read/write grants: parent permissions override more restrictive child rules.
5. Return to the app and log in with the email and password from step 2.

Only this first admin is created in the console. Every other account is created on the **Users** page (Phase 8). Never put passwords, hashes, or salts in Realtime Database. Firebase Authentication handles credentials. No public registration or automatic admin creation is provided.

## Access and data

`js/firebase.js` initializes your project using pinned Firebase CDN modules. `js/db.js` owns all club data access under `/mukando` and provides async `add`, `get`, `update`, and `list` for the club tables, plus the atomic multi-record operations (payments, payouts, closing a cycle, accounts, backup). Transactions prevent record ID collisions and lost concurrent updates. Firebase Authentication manages tab sessions; the app reloads the user's profile for role guards.

The current database rules allow admins and chairpersons to manage members, club rules and rotations. Staff can view payment history, but only treasurers can record or reverse payments. Audit events cannot be edited or deleted, and only admins can read the full audit trail. Members can read their own profile, linked member record, safe cycle projections and member-filtered payment history. Member access to entire tables is denied. Missing/inactive profiles cannot enter the dashboard. Database rules, rather than hidden links, enforce cloud access.

Local browser demo data is not migrated or uploaded. Firebase does not use the old localStorage records. `PLAN.md` preserves the original plan; this Firebase change supersedes its browser-storage and local-password requirements.

## Verify

- Try a wrong password: a clear error appears.
- Log in with the configured admin: dashboard placeholders appear.
- Refresh: the session stays active in that tab.
- Log out and visit dashboard.html directly: return to login.
- Set up another Auth user with a member profile: its dashboard contains no other-member data. In the Firebase Rules Playground, check that the member cannot read `/mukando/users` or `/mukando/members`, cannot write its own role, and can read `/mukando/users/ITS_UID`.
- Check a phone width (375px): inputs fit and cards stack.

## Limits

All nine phases are built. Firebase setup and rules must be published in your console; this repository alone cannot enable cloud services. No SMS, email reminders, or payment gateway is connected: WhatsApp reminders are copied or opened by a person. Confirm actual club rules through field research. See *Known limits* at the end of this file for what the browser and the rules can and cannot guarantee.

SDK setup reference: https://firebase.google.com/docs/web/setup
Security rules reference: https://firebase.google.com/docs/database/security

## Phase 2: Members and club rules

For Cloud Shell, open `PUBLISH-PHASE-2.sh` and paste its entire contents into the terminal. It backs up existing rules, accepts commented rules, and replaces only the `/mukando` permissions. It does not alter member data, user accounts or sibling application rules. Review any inherited root grants separately.

Alternatively, before saving members or club rules, publish the updated `database.rules.json` in **Firebase console → Realtime Database → Rules**. The earlier own-profile-only login fix is not enough: Phase 2 also writes member/rule records and an audit entry in the same request. When using a shared Firebase project, merge the supplied `mukando` subtree into your existing rules and preserve sibling applications. Any root-level read/write grants must be reviewed because parent permissions override child restrictions. A failed permission check leaves both the record and its audit event unchanged.

For admin and chairperson:

- `members.html`: search by name or phone, filter active/inactive, activate/deactivate, and open editing.
- `member-form.html`: required name, phone and join date; optional notes. New members start active. Phone numbers normalize spaces, hyphens and parentheses to 7–15 digits with an optional leading +. Join dates must be real dates and cannot be in the future.
- `rules.html`: club name, USD contribution amount, weekly/monthly frequency, start date, late penalty and grace days. Rules use the fixed ID `club` so refreshes update one record rather than creating duplicate configurations.

Amounts have at most two decimal places; contributions must be positive, penalties can be zero, and grace days are whole numbers from 0 to 365. Member names and phone numbers render with textContent. Members and treasurers are redirected away from all three management pages and do not see their menu links.

Existing cycles trigger a balance check before deactivation. Missing contributions, partial payments and overdue penalties produce a warning. As an additional safeguard while the cycle workflows are unfinished, **all deactivation is blocked once a rotation exists**, even if a member is fully paid. The Firebase rules enforce that lock too. Contribution terms and existing join dates also stay fixed once cycles exist to avoid changing recorded obligations. Later phases must introduce cycle membership review and snapshot the original contribution terms before relaxing these locks.

Changes to earlier files: `js/db.js` gained atomic record/audit saves; `js/ui.js` gained role-based page links and shared page setup; `js/utils.js` gained validation and balance helpers; `css/style.css` gained member tables and responsive forms; `database.rules.json` gained manager permissions, record validation and append-only audit events. Login, dashboard layout and appearance choices are retained.

### Verify Phase 2

1. Save club rules, refresh, and check that all values remain.
2. Add five members, edit one, and refresh the list.
3. Search for a name/phone and filter active/inactive records.
4. Deactivate one member before any rotation exists. Refresh, then reactivate them.
5. Try a blank name, invalid phone/date, negative contribution, and fractional grace days: saving is blocked.
6. Log in as a member or treasurer and open each management URL directly: return to the dashboard. Verify corresponding database requests are denied using Firebase Rules Playground.
7. Check mobile width and both appearance modes.

Automated verification used five sample members and Firebase module mocks inside an isolated browser; no live club records were created. Tests covered add/edit/status changes, search/filter, persistence across page refresh, audit entries, rules forms, validation, debt warnings, role guards, theme switching, skeletons on a slow connection and phone layout. The real Firebase permissions require the updated rules to be published in your console.

## Loading and navigation

Dashboard, member-list and form skeletons reserve space until authentication and their data reads finish. Errors replace skeletons with a clear message. Reduced-motion settings disable the shimmer. The login photo has a skeleton and the login button shows session-check progress.

Sidebar links are static HTML. The last verified username and role are cached on this device purely to paint the sidebar quickly across page loads. The cached role never grants access: every page still checks Firebase Authentication and the current cloud user profile, and database rules check permissions for each request. Logout clears the identity cache. Appearance and this visual identity cache are the only localStorage values used by the app.

The included `tests/firebase-rules.py` tests `database.rules.json` against a Realtime Database emulator at **127.0.0.1:9019**, using a separate demo namespace. It verifies compiled rules, roles, own-profile isolation, invalid records, append-only audit entries, atomic rollback, and schedule locks. It does not contact the live Firebase database.

## Phases 3 and 4: Rotation and payments

**Publish the current permissions before using these features.** Open `PUBLISH-PHASE-4.sh` and paste its entire contents into Google Cloud Shell. It backs up the existing (possibly commented) rules, preserves rules outside `/mukando`, and publishes the current Mukando rules. Existing club records and login accounts are not overwritten. `PUBLISH-PHASE-2.sh` is retained for the older phase; use the Phase 4 command now. As before, check that inherited root permissions do not grant access around the child restrictions.

### Rotation

Admins and chairpersons can create a round in `rotation.html`. Choose Random (shuffle) or Manual (accessible up/down buttons). Every active member gets exactly one recipient slot. The first cycle is open and later cycles are scheduled. Dates follow the saved weekly or monthly frequency; monthly dates keep the original day where possible (January 31 → February 28 → March 31). The first due date must not predate a participating member's join date.

Each cycle snapshots its participants, contribution amount, penalty, grace days and expected pool. Expected pool is contribution × members in that round. Recipient order can be changed in the unfinished part of the round; dates, financial terms and completed payouts stay fixed. All changes are audited, including whether the first payout already happened. A new round can only be created after the current one closes. Cycle closing and opening the next cycle arrive in Phase 5, so there is currently one open cycle per round.

### Payments

Only treasurers can use `record-payment.html` or create/reverse payments; admins and chairpersons view payment history. Select the open cycle, a participating member, amount, cash/EcoCash/bank method, date and optional reference. Dates must fall between the member's join date and today. Amounts must be positive, at most USD 1,000,000 and have at most two decimal places.

`payments.html` filters by cycle, member and date range, displays the exact net total of visible entries, and shows Paid / Partial / Unpaid with outstanding balances. Balances use the snapshotted contribution terms and integer cents. A late penalty applies after due date + grace days when the contribution was not paid by that deadline. The balance status includes unpaid penalties. Overpayments remain in the collected total; outstanding never goes below zero.

Receipts open in a dialog and print without navigation or action buttons. To fix a mistake, use Reverse, enter a reason, and record the correct payment. The original stays unchanged. One exact negative reversal is permitted per original, only while its cycle is open. Reversals use the original payment date for deadline calculations so reversing a mistaken on-time entry does not falsely remove a late penalty. Closed-cycle corrections need the later reconciliation workflow.

### Member privacy

A member account must have `memberId` in its `/mukando/users/AUTH_UID` profile, set to the ID of its existing member record. Accounts are linked in the Firebase console until Phase 8. Members see only their own payments and balances. Firebase enforces a `memberId`-filtered payment query. The app never downloads all members or all payments and then hides rows for a member.

Safe per-member cycle projections are stored in `/mukando/memberCycles`; they contain due dates, contribution terms and whether that member is the recipient, with no other members' names, IDs or balances. Other operational metadata: `rounds` prevents duplicate round creation, `roundRecipients` enforces distinct recipient slots, `participantIds` is the immutable participant roster on each cycle, `cycleLocks` protects completed payouts, and `paymentReversals` prevents duplicate corrections. All club data access remains in `js/db.js`.

Firebase rules enforce treasurer-only payment creation, append-only payment/audit records, exact single reversals, immutable contribution snapshots, unique recipient assignments, and member query privacy. The browser checks whole-round completeness and whether all cycles are closed before a new round; full cross-record aggregation enforcement would need a trusted backend for production.

### Verify Phases 3 and 4

1. Save rules, add three active members, generate a manual or random rotation, and refresh. Each member appears once and dates follow the frequency.
2. Reorder two recipients and save. The audit event and safe member projections update together.
3. Sign in as a treasurer (create an Authentication account and profile with `role: "treasurer"` in the console until Phase 8).
4. Record a partial contribution, then the remainder. The member changes from Partial to Paid. Refresh and check totals.
5. Filter payment history and print a receipt. Reverse a payment and check that its original stays visible while the net total decreases.
6. Link a member account and verify that only its own history/balances appear; direct access to another member's records is rejected.
7. Try the screens at phone width and switch appearance modes.

### Regression checks

- `node --experimental-default-type=module tests/finance.mjs`: dates, complete rounds, random permutations, pools, payment amounts, partial/full balances, penalties and reversals.
- Start the official Firebase Realtime Database emulator on `127.0.0.1:9019`, then run `python3 tests/firebase-rules.py` and `python3 tests/firebase-phase4.py`. Both use separate demo namespaces and never contact the live project.
- Browser checks used isolated Firebase mocks to exercise manual ordering, saved cycles, partial/full payments, reverse entries, filters, receipt printing, member-only reads, role guards and responsive themes. No live member or payment records were created by these checks.


## Phases 5 to 9

**Publish the rules first.** Open `PUBLISH-PHASE-9.sh` and paste its entire contents into Google Cloud Shell. Like the earlier scripts it backs up the current rules to `mukando-rules-before-phase9.txt`, keeps everything outside `/mukando`, and replaces only the Mukando rules. Existing club data and logins are untouched. It supersedes the Phase 2 and Phase 4 scripts.

### Roles at a glance

| Role | Pages | Can do |
|---|---|---|
| admin | Members, Rules, Rotation, Payments, Payouts, Reminders, Reports, Users, Backup, My account | Manage everything except money entries. Creates accounts, backs up and restores, reads the audit trail, approves closing a cycle. |
| chairperson | Members, Rules, Rotation, Payments, Payouts, Reminders, Reports, My account | Set rules, manage members and rotation, approve closing a cycle with unpaid members, set reminder timing. |
| treasurer | Payments, Record payment, Payouts, Reminders, Reports, My account | Record and reverse payments, record payouts, confirm receipt, close cycles. |
| member | Payments, Reminders, My account | Own balance, history, payout date and reminders only. |

### Phase 5: Payouts (`payouts.html`)

A cycle moves through four steps: **collect → record payout → recipient confirms → close**.

- The treasurer records the payout. The amount is always the net money collected for the cycle (payments minus reversals). Recording it **freezes the cycle's payments**; the database refuses new payments or reversals after that.
- The recipient confirms in **My account** ("I received this payout"), or the treasurer ticks it on the Payouts page.
- The treasurer then closes the cycle. Closing, opening the next cycle and the audit entry are one all-or-nothing write. A member's cycle view is updated in the same write.
- **Unpaid members:** a cycle closes only when every member is Paid (including any late penalty), or when the chairperson (or admin) approves closing with a written reason. The approval is create-only and audited. After the last cycle in a round closes, a new round can be created on the Rotation page.
- Payouts are append-only. The database allows the treasurer to move a cycle from open to closed only after a confirmed payout exists, and to open the next cycle only when the one before it is closed. Chairpersons and admins cannot change cycle status.

### Phase 6: Reminders (`reminders.html`)

- Reminders are generated from cycle due dates, so they always match the schedule: a club-wide payment notice, a payout notice, and (once the due date has passed) a nudge for each member who still owes money, including late penalties. Chairpersons and admins add meeting reminders.
- A reminder appears the configured number of days before its date (default **2**, set on the same page by a chairperson or admin, 0 to 30). Overdue payment nudges stay until the money arrives.
- **Copy WhatsApp message** copies the text and marks the reminder as shared; **Open WhatsApp** opens a chat with the member's phone number. Nothing is sent automatically.
- The dashboard shows a badge such as "3 reminders due".
- Members see their own payment and payout reminders and the club's meeting notices. Payment nudges (which name other members and amounts) are readable by staff only.

### Phase 7: Reports (`reports.html`)

Club summary, cycle summary, member statement and defaulters list. Every figure is calculated from the same payment records and balance function the Payments page uses, so totals match exactly. A member statement shows what is **owed now** separately from amounts on cycles that are **not yet due**. Defaulters are members who still owe money after a cycle's due date plus grace days. **Print** uses a print stylesheet (menus and buttons hidden). **Export CSV** downloads the report you are viewing; cells that begin with `=`, `+`, `-` or `@` are prefixed so spreadsheets cannot run them as formulas.

### Phase 8: Users, backup, audit trail, My account

- **Users** (admin): create an account with an email, display name, temporary password, role, and (for members) the member it belongs to. Each member can have one account. The page signs the person up through a temporary second Firebase app, so you stay signed in; only the profile (never a password) is saved in the database. **Reset password** emails the person a Firebase reset link. Roles and links can be edited, and accounts deactivated (not yourself). New accounts show a "choose your own password" notice until they change it.
- **My account** (everyone): profile, change password (needs the current password), and for members: balance by cycle, payment history, next payout, payouts received, reminders, and the payout confirmation button.
- **Backup** (admin): *Download backup* saves every club record as JSON (no passwords exist in the database). *Import backup* rebuilds an **empty** club: it refuses if members, cycles, payments or payouts already exist, so it can never overwrite records. To restore after a loss, clear the club's data in the Firebase console (keep the `users` profiles), then import. Restore mode is switched on only for the import, only for admins, and only while the club is empty; opening the Backup page switches it off again if an import was interrupted. Sign-in profiles are not restored (they would be your existing logins).
- **Audit trail** (admin, on the Backup page): every change is listed with who, when and what, and can be searched.

### Phase 9: Polish

The dashboard is built to fit one laptop screen. Top row: a **cash in hand** card (collected minus paid out, with a trend line), then members, collected this cycle, outstanding and next payout. Quick-action buttons for your role sit beside the title. Below: **collections by cycle** (animated stacked columns: collected vs still to collect), **this cycle** (members Paid / Partial / Unpaid), **how members pay** (cash, EcoCash, bank), **round progress** (a step for every cycle, the open one pulses), and short lists for **needs attention**, **reminders** and **recent payments**. Charts animate in (unless the device asks for reduced motion), show a tooltip on hover and keyboard focus, and have a *View as table* button. Members see only their own figures. On phones the top figures sit two by two and the lower panels fold away until tapped. Colours come from a validated palette and have dark-mode versions; status colours always come with an icon and a label. The charts are plain SVG in `js/charts.js` with their numbers worked out in `js/dashboard-data.js` (tested by `tests/dashboard-data.mjs`). Loading skeletons, empty states and plain-English errors are used throughout. The layout is mobile-first: on phones the sidebar becomes a slide-in menu opened from the top-left button (closes on Escape, on tapping outside, or after choosing a page), tables turn into stacked cards with a label on every value, forms and buttons are full width with thumb-sized targets, and inputs use 16px text so phones do not zoom in. Every page was checked at 390px wide with no sideways scrolling. If some figures cannot load (for example, before the club rules exist) the page still opens and says so.

### Verify Phases 5 to 9

1. Publish the rules. Create a rotation, record payments for every member, then open **Payouts**: *Record payout*. Try recording a payment afterwards: it is refused.
2. Sign in as the recipient: **My account → I received this payout**. Back on Payouts, *Close cycle and open next*. The next cycle opens and the payout appears in history.
3. Leave one member unpaid: closing is blocked until the chairperson uses *Approve closing with unpaid members*.
4. **Reminders**: change the days-before setting, add a meeting, copy a message. A member sees the meeting but not other members' nudges.
5. **Reports**: switch between the four reports, print one, export CSV and compare totals with Payments.
6. **Users**: create a treasurer and a member account, link the member, reset a password, deactivate one.
7. **Backup**: download, clear the club data in the console (keep users), import. Everything returns; the audit trail records the changes.
8. Open every page at 375px wide in light and dark mode.

### Automated checks

Start the Firebase Realtime Database emulator on `127.0.0.1:9019`, then:

```
node --experimental-default-type=module tests/finance.mjs   # money maths
node tests/logic.mjs                                         # reminders and report totals
node tests/dashboard-data.mjs                                # dashboard chart numbers add up
python3 tests/firebase-rules.py && python3 tests/firebase-phase4.py   # earlier rules
cd tests && npm install && node integration.mjs              # real js/db.js against the real rules
```

`tests/integration.mjs` runs the actual `js/db.js` against the emulator as several different signed-in users, including attempts to bypass the app (forged audit entries, closing a cycle out of order, confirming someone else's payout) and a full backup, wipe and restore round trip. `tests/e2e/` drives the real pages in Chrome against the same emulator (see its `README.md`). Everything uses a separate demo namespace and never contacts the live project.

### Demo data

To see a busy club (20 members, a full year of monthly payments since January, payouts, late and unpaid members, a corrected payment, a meeting reminder), paste `SEED-DEMO-DATA.sh` into Google Cloud Shell. If the club already has records, they are **replaced**: the old records are first saved to `mukando-before-demo-DATE.json` in your Cloud Shell folder, login accounts are kept (member accounts are re-linked to the first demo members), and your club name, amount, penalty and grace days are kept with the start date moved to 5 January. Set `REPLACE_EXISTING=no` on the script's first lines to make it refuse instead. It needs an active admin profile; treasurer actions use your treasurer profile if there is one, otherwise the admin. `REMOVE-DEMO-DATA.sh` clears it again: change `CONFIRM_DELETE=no` to `yes` first. That deletes members, rotation, payments, payouts, reminders and the audit trail (including anything you recorded after seeding) but keeps logins and rules.

## Offline use and sync

The app works without internet once it has been opened and logged in online on that device.

- **Local database:** `js/localdb.js` keeps a SQLite copy of the club data on the device (sql.js, files in `vendor/`, saved in IndexedDB). There is one database per login, so another account on the same device never sees it.
- **Online:** `js/sync.js` sends every write to Firebase first, so the database rules still decide, and then copies it into SQLite. Reads come from Firebase and refresh SQLite.
- **Offline:** reads come from SQLite. Writes go into SQLite and a queue (the outbox) that survives closing the browser.
- **Back online:** the queue is sent in order, then the server's data replaces the local copy (a role-aware download: staff get everything they may read, members only their own records). The page also syncs every minute and when the tab becomes visible. If another person changed something, the badge offers "Refresh page".
- **Refused changes:** if the rules reject a queued change (for example a payment on a cycle that was paid out meanwhile), it is removed from the device, the server's version is restored, and the badge lists what was refused.
- **Offline login:** after each online login a salted PBKDF2 hash of the password (never the password) is kept on the device. Offline, the email and password are checked against it. Because there is no Firebase session, the badge asks for the password once when the connection returns, then syncs. A changed password is updated on the device when changed through My account.
- **Service worker (`sw.js`):** keeps the pages, scripts, Firebase SDK and Font Awesome so pages open with no network. Bump `VERSION` in `sw.js` when adding files to its list.
- **Online only:** restoring a backup, creating accounts and changing passwords need a connection.
- **Limits:** offline, the database rules cannot check anything; the checks run when the change is sent. Offline logins also keep working for a person an administrator deactivated until that device syncs. The cloud database is the Realtime Database, not Firestore.
- **Tests:** `tests/offline.mjs` (SQLite layer against the emulator), `tests/e2e/offline.mjs` (offline login, save and sync in Chrome) and `tests/e2e/sw.mjs` (service worker; needs internet for the first load).

## Known limits

- **Rules versus a backend.** Firebase rules cannot add up many records. The browser checks that every member is paid before a cycle closes and that a payout equals the amount collected; a determined treasurer using the Firebase SDK directly could skip those two checks (the rules do still require a confirmed payout, correct cycle order, append-only records and audit entries). A real deployment that handles significant money should move these two checks to a trusted server (Cloud Functions).
- Audit entries are written by the signed-in user's browser, so they prove who acted but are not tamper-proof against someone with database owner access.
- Members cannot read other members' records at all, but treasurers and chairpersons can read every member's phone number (needed for reminders).
- Once a rotation exists, members cannot be deactivated and the contribution terms cannot be changed (a Phase 2/3 safety lock that still applies after rounds finish). Letting a club change members or terms between rounds needs a member-review step and is future work.
- Restore refuses to run over existing records; partial restores need the Firebase console.
- Restoring does not recreate sign-in logins. Accounts are re-linked through the Users page or the Firebase console.
- No SMS, email reminders or payment gateway. EcoCash or bank integration is future work.
- Amounts are in US dollars. Confirm the club's real rules, roles and currency through field research.
