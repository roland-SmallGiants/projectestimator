# Small Giants — Client Work Estimator

Standalone rebuild of the Claude-Artifact version, on Firebase/Firestore.
Plain JS + ES modules, no build step, no framework.

**This has not been tested against a live Firebase project** — I don't have
a way to run that from where this was written. Budget a real testing pass
once your config is in place, ideally with the
[Firestore emulator](https://firebase.google.com/docs/emulator-suite) first.

## What's new vs. the Claude Artifact version

The old version had one single shared "live workspace" — two people
scoping different clients at once would overwrite each other. This version
replaces that with **drafts**: any number of in-progress quotes can exist
at once, all visible to the whole team, each with its own tasks/hours/
roles. Opening a draft locks it (a heartbeat-based soft lock, ~2 minute
timeout) so only one person edits it at a time; everyone else sees it
read-only with a banner showing who's in it. See the code comments in
`src/drafts.js` for the exact mechanics and trade-offs.

## Setup

1. **Create a Firebase project** at [console.firebase.google.com](https://console.firebase.google.com).
2. **Enable Firestore** (Build → Firestore Database → Create database — start
   in production mode, the rules file here handles access).
3. **Add a Web app** to the project (gear icon → Project settings → Your
   apps → Web) and copy the config object it gives you.
4. Paste that config into **`src/firebase-config.js`**, replacing the
   `REPLACE_ME` placeholders.
5. **Deploy the security rules**: `firebase deploy --only firestore:rules`
   (requires the [Firebase CLI](https://firebase.google.com/docs/cli):
   `npm install -g firebase-tools`, then `firebase login` and
   `firebase use --add` to point it at your project).
6. **Run it locally** — since this uses ES modules, opening `index.html`
   directly (`file://`) won't work; serve it, e.g. `npx serve .` or
   `python3 -m http.server`, then open the printed localhost URL.
7. **Deploy for real** — `firebase deploy --only hosting`, or push to
   Vercel/Netlify (drag-and-drop the folder or connect the GitHub repo —
   no build command needed, the publish directory is the project root).

## First run

The app seeds sensible defaults (6 disciplines, 4 roles, admin PIN `1234`)
the first time it sees an empty `disciplines` collection — see
`bootstrapDefaultsIfEmpty()` in `src/admin.js`. Change the PIN from Admin →
Rate Card once you're in (look for the "Change admin PIN" control — port
note: this control exists in the original artifact's Rate Card section but
double-check it made it into `admin.js` here; if not, it's a two-line add
next to the existing rate-card wiring).

## Project structure

```
index.html              Shell + all view markup
firestore.rules         Security rules (currently open — see the file's own comment)
firebase.json           Hosting config
src/
  firebase-config.js     YOUR Firebase project config — fill this in
  firebase-init.js       SDK init + a thin collection().doc() wrapper
  utils.js               Formatting, nice-axis chart math, small helpers
  state.js               Central app state
  modals.js              Custom confirmation modal (native confirm() is intentionally avoided)
  nav.js                 View switching
  welcome.js             Identity picker + Roland's PIN gate
  drafts.js              NEW — drafts list, creation, locking/presence
  estimator.js           Discipline picker, work breakdown, summary (per-draft)
  quotes.js              Archive: save, list, edit, Won/Lost, CSV export
  report.js              Charts (3 types) + the auto-generated insights
  admin.js               Rate card, disciplines/task catalog, pricing, team
  app.js                 Wires it all together
  styles.css
```

## Known gaps / things to verify once this is live in a real browser

- **PNG export** (html2canvas-based quote image export) from the original
  artifact was not ported — CSV export is in `quotes.js`, PNG isn't yet.
- **Notes-column responsive behavior** (auto-collapsing to an icon when a
  task name wraps) from the original wasn't ported — a nice-to-have, not
  load-bearing.
- The original app worked around some quirks specific to the Claude
  Artifact sandbox (native `<title>` tooltips and `confirm()`/`alert()`
  didn't render reliably there, so custom replacements were built for both).
  Those replacements were kept here since there's no downside to them, but
  it's worth knowing a plain browser deployment may not have needed the
  workaround in the first place.
- This has real users reachable outside a sandboxed environment now —
  `firestore.rules` is currently wide open (matching the original's trust
  model of "no login, identity is just a name you pick"). Revisit this if
  that's ever not an acceptable trade-off for how this gets shared/hosted.
