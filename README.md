# Mukando Manager

A simple web app for running a mukando (rotating savings) club. It records members, monthly contributions, the payout order, reminders and reports.

**It records information only. It does not move money.**

Built for the Agape Fushai Group. Plain HTML, CSS and JavaScript (ES modules), with Firebase Authentication and Realtime Database. No framework and no build step.

## Features

- **Members and rules:** member list, club rules and contribution amounts
- **Rotation:** who receives the pot, and when
- **Payments and payouts:** record and reverse payments, record payouts, confirm receipt, close cycles
- **Reminders and reports:** payment reminders, totals and charts
- **Users and backup:** role-based accounts, backup and restore, audit trail
- **Mobile first:** works on phones, with light and dark themes

## Roles

| Role | Can do |
|---|---|
| admin | Manage users, backups and the audit trail. Cannot enter money records. |
| chairperson | Set rules, manage members and rotation, approve closing a cycle |
| treasurer | Record payments and payouts, close cycles |
| member | View own balance, history, payout date and reminders |

## Run locally

```
python3 -m http.server 8001 --bind 127.0.0.1
```

Open http://localhost:8001. Use localhost or HTTPS, not a file URL. Internet access is needed for Firebase.

Before the first login, enable Email/Password sign-in in Firebase, create an admin user, and publish the database rules. The full steps are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Tests

Logic, database-rule and browser tests run against the Firebase emulator and never touch the live project. Commands are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#automated-checks).

## Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): Firebase setup, phase-by-phase notes, verification and known limits
- [PLAN.md](PLAN.md): the original build plan
