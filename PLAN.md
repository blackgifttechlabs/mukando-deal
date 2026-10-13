# Mukando Manager: Build Plan for Claude Code

Put this file in the project root. Tell Claude Code: "Read PLAN.md. Build one phase at a time. Stop after each phase and wait for me."

## 1. Goal

Build a web system to manage a mukando (rotating savings) club. It records members, contributions, payout order, reports and reminders. It does NOT move money. No payment gateway.

Case study club: Agape Fushai Group.

## 2. Tech rules

- Plain HTML, CSS and JavaScript only. No frameworks, no build step.
- Use ES modules (`type="module"`).
- Multi-page site. One HTML file per page.
- Store data in the browser with IndexedDB (or localStorage if simpler).
- Put ALL data access in one file (`js/db.js`). Pages never touch storage directly. This lets us swap to a real backend later.
- Mobile-first, responsive. Many users will be on phones.
- Simple English in all labels and messages.
- Add comments to code so a student can explain it.
- Hash passwords with `crypto.subtle` (SHA-256 + salt). Note in the README that browser-only login is for demo, not real security.

## 3. Folder structure

```
mukando-manager/
  index.html            (login)
  dashboard.html
  members.html
  member-form.html
  rules.html
  record-payment.html
  payments.html
  rotation.html
  payouts.html
  reminders.html
  reports.html
  users.html
  backup.html
  my-account.html
  css/
    style.css
  js/
    db.js               (all storage)
    auth.js             (login, session, role checks)
    utils.js            (dates, money format, validation)
    ui.js               (nav, toast, modal, table helpers)
    members.js
    payments.js
    rotation.js
    reminders.js
    reports.js
    audit.js
  README.md
```

## 4. Data model

| Table | Fields |
|---|---|
| users | id, username, passwordHash, salt, role, memberId, active |
| members | id, fullName, phone, joinDate, status (active/inactive), notes |
| rules | clubName, amount, frequency (weekly/monthly), startDate, penaltyAmount, graceDays |
| cycles | id, number, dueDate, recipientMemberId, status (open/closed) |
| payments | id, cycleId, memberId, amount, method (cash/ecocash/bank), reference, date, recordedBy |
| payouts | id, cycleId, memberId, amount, date, confirmed (true/false), recordedBy |
| reminders | id, type (payment/payout/meeting), message, date, sent |
| auditLog | id, time, userId, action, details |

## 5. Roles and permissions

| Role | Can do |
|---|---|
| admin | Manage users, backups, audit trail. View everything. |
| chairperson | Set rules, manage members, create rotation, view all reports. |
| treasurer | Record payments, confirm payouts, print statements. |
| member | See only own balance, history, payout date, reminders. |

Rules:
- Every page checks the role on load. Wrong role = redirect to dashboard.
- Hide menu links the user cannot use.
- Members must never see other members' data.

## 6. Business rules

1. Each cycle has one recipient. Every active member receives once per round.
2. Expected pool per cycle = contribution amount x number of active members.
3. Status per member per cycle: Paid (full), Partial, Unpaid.
4. Outstanding = expected amount minus total paid. Add penalty if paid after due date plus grace days.
5. A cycle can close only when all payments are recorded or the chairperson approves closing with unpaid members.
6. Payout amount defaults to the total collected for that cycle.
7. Payments cannot be deleted. To fix a mistake, add a reversing entry. Log every change in the audit trail.
8. Rotation order can be Random or Manual. Any change after the first payout is logged.
9. Do not allow a member to be deactivated while they still owe money (show a warning).

## 7. Phases

### Phase 1: Foundation
- Create folder structure, `style.css` (clean, simple, mobile-first), shared nav and layout.
- Build `db.js` with add, get, update, list for each table.
- Build `auth.js`: login, logout, session, role guard.
- Seed one admin user (`admin` / `admin123`) on first run. Show a warning to change it.
- Pages: `index.html` (login), `dashboard.html` (empty cards for now).

Check: I can log in and out. Wrong role is blocked.

### Phase 2: Members and rules
- `members.html`: table, search, filter by status, activate/deactivate.
- `member-form.html`: add and edit with validation (name required, phone format).
- `rules.html`: set amount, frequency, start date, penalty, grace days.
- Chairperson and admin only.

Check: add 5 members, edit one, deactivate one, change rules. Data stays after refresh.

### Phase 3: Rotation schedule
- `rotation.html`: generate cycles for all active members (Random or Manual drag/order).
- Show table: cycle number, due date, recipient, status.
- Log any change in audit trail.

Check: dates follow the frequency. Each member appears once.

### Phase 4: Payments
- `record-payment.html`: pick cycle, member, amount, method, reference, date. Validate.
- `payments.html`: history with filters (cycle, member, date), totals, print receipt.
- Calculate Paid / Partial / Unpaid and outstanding per member per cycle.
- Treasurer only to record. Others view.

Check: pay partial, then pay the rest. Status updates correctly.

### Phase 5: Payouts
- `payouts.html`: show current recipient and amount collected.
- Treasurer records payout. Recipient confirmation is ticked (by treasurer, or by the member in `my-account.html`).
- Closing a payout closes the cycle and opens the next one.

Check: full cycle from open to closed works.

### Phase 6: Reminders
- `reminders.html`: list upcoming payment deadlines, payouts and meetings.
- Auto-generate reminders from cycle due dates.
- Show in-app notification badge on the dashboard.
- Add a "Copy WhatsApp message" button for each reminder (no real SMS needed).

Check: reminder appears 2 days before due date (configurable).

### Phase 7: Reports
- `reports.html`: member statement, cycle summary, club summary, defaulters list.
- Print-friendly CSS. Export to CSV.

Check: totals match the payments table exactly.

### Phase 8: Users, audit and backup
- `users.html`: create users, assign role, link to member, reset password, deactivate.
- `backup.html`: export all data to a JSON file. Import from JSON. View audit trail.
- `my-account.html`: member sees own balance, history, next payout date, change password.

Check: export, clear data, import. Everything returns.

### Phase 9: Polish
- Dashboard with real numbers (members, collected this cycle, outstanding, next payout, reminders).
- Empty states, loading states, friendly errors.
- Test on a phone-sized screen.
- Write README: how to run, demo accounts, limits, future work.

## 8. Prompts to give Claude Code

Start with:

> Read PLAN.md fully. Build Phase 1 only. Follow the tech rules. When done, tell me how to test it and wait.

Then, for each next phase:

> Phase 1 works. Build Phase 2 from PLAN.md. Do not change earlier files unless needed, and tell me if you do.

For fixes:

> Bug: [describe]. Find the cause, fix it, and explain in simple English.

At the end:

> Review the whole project against PLAN.md section 6 (business rules). List anything missing or wrong.

## 9. Definition of done

- All 14 pages work and match the roles table.
- Business rules in section 6 are enforced.
- Data survives refresh. Backup and restore works.
- Works on phone and desktop.
- README explains setup and limits.

## 10. Known limits (write these in the report)

- Browser storage means data lives on one device. A real version needs a server and database.
- Client-side login is not secure for real money data.
- No real SMS, email or payment gateway. EcoCash or bank integration is future work.
- Confirm the club's real rules and roles during field research. Change the rules page to match.