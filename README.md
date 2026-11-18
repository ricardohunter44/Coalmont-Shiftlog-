# Jobflow

Field service job log and timesheet for your phone. Hours with travel/shop overtime, time-stamped notes, on-site time, photos, video and any file type (.ACD, .L5X, Word, Excel, PDF, ZIP, .MOV) per job. Installs to your home screen and works with no signal and no Claude.

## Where your data lives

Everything is stored on the phone itself. Nothing leaves the phone unless you use AI help. That is what makes it work at plants that block outside access, and it also means:

- **Back up regularly.** Settings tab → Create backup file → save it to iCloud Drive, Google Drive, OneDrive or your laptop. The app reminds you after 7 days.
- **New phone:** install Jobflow, then Settings tab → Restore from a backup.
- **Install it to the home screen.** On iPhone, Safari can clear storage for websites you haven't opened in a while. Installed home-screen apps are exempt. Also tap "Protect data from cleanup" on the Settings tab.

## Put it online (one time, about 5 minutes)

The app needs to be hosted on an https address once so your phone can install it. After that it runs offline.

**Option A: Netlify Drop (fastest, no account setup)**
1. Unzip this folder.
2. Go to app.netlify.com/drop and drag the `jobflow-app` folder onto the page.
3. You get an address like `https://something.netlify.app`. Sign in to keep it permanently.

**Option B: Vercel (same as Plantflow)**
1. Put this folder in a new GitHub repo.
2. On vercel.com: Add New → Project → import the repo. Framework preset: **Other**. No build command, output directory `./`.
3. Deploy.

## Install on your phone

- **iPhone:** open the address in **Safari** → Share button → **Add to Home Screen**.
- **Android:** open in **Chrome** → menu (⋮) → **Install app**.

Open it once while you have signal. From then on it opens with no connection.

## Time (hours)

The **Time** tab tracks your hours.

- **Clock in / Clock out:** pick the day type (Travel, Shop, Job site), tap **Clock in now**, and tap **Clock out** at the end of the day. Pick your lunch or break before clocking out; it's unpaid and comes out of regular time first.
- **+ Add hours:** type in a day you forgot to clock, or one from the past. The box at the bottom shows regular and overtime before you save, and warns you if that date already has hours.
- **Overtime:** time worked after the day type's cutoff counts as overtime. Travel days: after 3:00 PM. Shop days: after 5:00 PM. Job site starts with no cutoff. Set it, or add other day types, under **Day types & overtime** at the bottom of the Time tab. Changing a cutoff only affects hours entered after the change.
- **Week view:** total, regular and overtime hours for the week, plus how many travel and shop days. Use ‹ › to go back through past weeks. Tap any entry to edit or delete it.
- **Week summary** copies the week as text for a timesheet, text or email. **Save CSV** saves any date range as a spreadsheet.
- Hours are included in backups.

## Job summaries and AI help

Each job has a **Summary** button with three views:

- **Organized** (works offline): your notes sorted into Work performed, Issues found, Program changes, Testing, Parts, Safety and Follow-up by their tag, with per-day time on site.
- **AI summary** (needs signal): a written service report built from the job log. You can edit it and save your changes. If you log more afterwards, it tells you so you can rewrite it.
- **Full log**: every entry exactly as logged.

When AI is on, the note box also has a **Tidy with AI** button that cleans up a quick note before you save it, with Undo.

To turn AI on:
1. Go to console.anthropic.com, create an account, add billing, and create an API key. Set a monthly spend limit while you're there.
2. In Jobflow: Settings → AI help → paste the key → Test → Save.

The key stays on your phone and is not included in backups. AI only uses what you logged, and you should still read each summary before sending it. Notes sent to AI go to Anthropic for processing, so check that a customer is fine with that before using it on their jobs.

## Updating the app later

When you change any file, also change `VERSION` at the top of `sw.js` (for example `jobflow-v1.2.1`) and redeploy. The app shows "A new version of Jobflow is ready" with an Update button. Your jobs are not affected by updates.

## Files

- `index.html`, `css/app.css`, `js/app.js` — the app
- `js/db.js` — on-device storage (IndexedDB)
- `js/timecalc.js` — hours and overtime math
- `sw.js` — offline support
- `manifest.webmanifest`, `icons/` — home-screen install
- `vendor/jszip.min.js` — builds backup and export .zip files
- `fonts/` — IBM Plex fonts, bundled so they work offline
