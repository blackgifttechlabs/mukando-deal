# Browser tests

Runs the real pages in Chrome against the **Firebase Realtime Database emulator** with the real `database.rules.json`. The Firebase CDN modules are replaced by small stand-ins (`shims.mjs`) that talk to the emulator over REST and fake sign-in, so no live project is touched.

1. Start the emulator on `127.0.0.1:9019`.
2. From the project folder: `python3 -m http.server 8765 --bind 127.0.0.1`
3. `cd tests/e2e && npm install && node e2e.mjs` (set `CHROME=/path/to/chrome` if Chrome is not at `/usr/bin/google-chrome`; screenshots go to `$SHOTS` or the temp folder).

It walks a whole club through the browser as each role: rotation, contributions, payout, recipient confirmation, approval and closing, reminders, reports (including CSV), user management, backup, wipe and restore, password change, and phone-width layout checks.

`node mobile.mjs` loads the demo data (`SEED-DEMO-DATA.sh`) and checks every page at 390px wide: the slide-in menu opens and closes (button and Escape), tables become cards, nothing scrolls sideways and touch targets are large enough.
