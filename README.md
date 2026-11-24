# Monty Hall classroom experiment

A replication of Friedman (1998), *Monty Hall's Three Doors*, AER 88(4), for about 20 students who play at the same time on their own phones.

- **Game:** `index.html`. Students open it from a QR code. It is mobile-first, needs no login and is in English.
- **Results:** `results.html?key=YOUR_ADMIN_KEY`. Open this on your laptop and project it at the end.
- **Data:** a Google Sheet you own, written by a Google Apps Script web app (`apps-script/Code.gs`).

```
index.html  app.js        the game (state machine, offline queue)
results.html results.js   presenter page (charts, table, CSV download)
style.css                 shared styles
config.js                 ALL settings: API_URL, rounds, points
apps-script/Code.gs       back end, pasted into Apps Script
tools/make_qr.py          makes qr-game.png and qr-results.png
tests/                    local checks (not needed online)
```

---

## Part A: Google Sheet and Apps Script (about 10 minutes)

1. Go to <https://sheets.google.com> and create a **blank spreadsheet**. Name it, for example, *Monty Hall data*.
2. In the menu, choose **Extensions → Apps Script**. A code editor opens in a new tab.
3. Delete everything in `Code.gs`. Open `apps-script/Code.gs` from this folder in Notepad, copy **all** of it, and paste it in. Click **Save** (the disk icon).
4. Set the admin key:
   - Click **Project Settings** (the ⚙ gear icon on the left).
   - Scroll to **Script Properties** and click **Add script property**.
   - Property: `ADMIN_KEY`. Value: a long secret word you make up, for example `blue-otter-7713`. Write it down.
   - Click **Save script properties**.
5. Deploy it as a web app:
   - Click **Deploy → New deployment**.
   - Click the ⚙ next to "Select type" and choose **Web app**.
   - Description: `v1`. **Execute as: Me**. **Who has access: Anyone**.
   - Click **Deploy** and then **Authorize access**, and choose your Google account.
   - Google shows "Google hasn't verified this app". This is normal for your own script. Click **Advanced → Go to … (unsafe) → Allow**.
   - Copy the **Web app URL**. It ends in `/exec`.
6. Test it: paste the URL into a browser tab. You should see `{"ok":true,"service":"monty-hall",…}`.
7. Go back to the Sheet tab and reload it. A **Monty Hall** menu appears. Click **Monty Hall → Set up sheets**, which creates the `participants` and `decisions` tabs with headers. Do not rename or reorder those columns.
8. Open `config.js` in Notepad and replace `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` with your `/exec` URL. Keep the quotes and save.

> **Settings:** the rounds and points are set in `config.js`, and **also** in the `SETTINGS` block at the top of `Code.gs`. If you change one, change both and redeploy (see Part D). If they differ, the game shows a "Setup error" message instead of starting, so the pilot will catch it.

## Part B: Put the site on GitHub Pages (about 10 minutes)

1. Sign in at <https://github.com> (create a free account if needed).
2. Click **+ → New repository**. Name it, for example, `monty-hall`. Choose **Public** (free Pages needs a public repo) and click **Create repository**.
3. On the new repo page, click **uploading an existing file**. Drag in **everything in this folder** (`index.html`, `results.html`, `config.js`, `style.css`, `app.js`, `results.js`, the `apps-script`, `tests` and `tools` folders and this README), then click **Commit changes**.
4. Go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main** and folder **/ (root)**, then click **Save**.
5. After 1–2 minutes the page shows your public link: `https://USERNAME.github.io/monty-hall/`.
   - Game: `https://USERNAME.github.io/monty-hall/`
   - Results: `https://USERNAME.github.io/monty-hall/results.html?key=YOUR_ADMIN_KEY`

The admin key is **never** stored in the repository. You type it into the results link yourself. The results page removes the key from the address bar right after loading, so it doesn't show on the projector.

To change a file later, open it on GitHub, click the ✏ pencil, edit it and click **Commit changes**. The site updates in about a minute.

## Part C: QR codes

One-time setup on your PC (needs Python):

```bash
python -m pip install segno
```

Then make both PNGs (use your own link):

```bash
python tools/make_qr.py https://USERNAME.github.io/monty-hall/
```

- `qr-game.png` is the game link. Project it for the class.
- `qr-results.png` is the results page **without** the key. On your own laptop, add `?key=YOUR_ADMIN_KEY` to the address.

## Part D: Redeploying after changing `Code.gs`

Apps Script keeps running the **old** code until you publish a new version:

1. In the Apps Script editor, paste or save the new code.
2. Click **Deploy → Manage deployments**, then the ✏ pencil on your deployment.
3. Under **Version**, choose **New version** and click **Deploy**.

This keeps the **same URL**, so you don't need to change `config.js`. Don't use "New deployment" for an update: that creates a different URL.

## Part E: Pilot data and running the session

- **Pilot link:** add `?pilot=1`, for example `https://USERNAME.github.io/monty-hall/?pilot=1`. Every row from that phone is saved with `is_pilot = 1`, and a red **PILOT** tag shows at the top. Pilot players get their own Track/Control sequence, so they can't unbalance the real class.
- **Reset a test phone:** open the game once with `?reset=1` (for a pilot phone, use `?reset=1&pilot=1`). This clears the saved progress on that phone so you can play again with a new code name.
- **Delete pilot data before the real session:** in the Sheet, click **Monty Hall → Delete pilot rows**. Only rows with `is_pilot = 1` are deleted.
- **Start completely fresh:** click **Monty Hall → Delete ALL data (fresh start)**. This deletes everything, including the real data. Use it only before the real session.
- **During class:** project `qr-game.png`. On your laptop, open the results link and leave the charts hidden. The counter shows *registered · finished*. When everyone has finished, click **Reveal results**.
- **After class:** click **Download decisions.csv** and **Download participants.csv**. These contain all rows, including the `is_pilot` column, whatever the toggles are set to. The Google Sheet itself also keeps everything.

## Pilot checklist

Do this a few days before class, with the `?pilot=1` link.

- [ ] Play the whole game on **2–3 phones** (at least one iPhone/Safari and one Android/Chrome). Check that there's no sideways scrolling and that everything is easy to tap.
- [ ] **Invalid inputs:** press Continue with an empty code name, with one character, and with symbols like `#!`. Leave a background question empty. Choose a wrong answer in the quick check (the hint must appear and the error count must go up). Leave the exit questions empty.
- [ ] **Duplicate code name:** on phone 2, use the same code name as phone 1. You must see "This code name is taken, please choose another".
- [ ] **Reload mid-game:** in the middle of a round (after picking a card), reload the page or close and reopen the tab. It must come back to the same round with the same cards.
- [ ] **Airplane mode:** turn on airplane mode, play 1–2 rounds (the top corner shows "offline – will retry"), then turn it off. Within a few seconds it must show "saved ✓", and the rows must appear in the Sheet with no gaps or duplicates.
- [ ] **Sheet check:** each phone has exactly 10 rows in `decisions` (5 + 5). `group` is `Baseline` in Run 1 and `Track` or `Control` in Run 2. `participants` shows `finished = 1` and the right `total_points`. Pilot players alternate Control, Track, Control, Track in the order they register.
- [ ] **Track box:** a Track phone shows the "If you had always switched / stayed" box after each Run 2 round. A Control phone never shows it.
- [ ] **Results page by hand:** untick "Exclude pilot data". For one round, count the switches in the Sheet yourself (or use a filter) and compare with Chart 1. Do the same for one cell of the table.
- [ ] **Time the session** from scanning the QR code to the thank-you screen.
- [ ] Afterwards, click **Monty Hall → Delete pilot rows**.

## Data dictionary (main points)

**`decisions`** has one row per round. A round is identified by `participant_id + run + period`, and the server ignores duplicates.

| column | meaning |
|---|---|
| `participant_id` | the code name in capitals (spaces removed) |
| `device_token` | random ID stored on the phone |
| `group` | `Baseline` in Run 1; `Track` or `Control` in Run 2 |
| `prize_card`, `first_pick`, `revealed_card`, `final_card` | cards 1–3, numbered left to right |
| `switch`, `won` | 1 or 0 |
| `points` | 40 or 10 |
| `cum_points` | the player's points so far **within this run**, including this round |
| `always_switch_cum`, `always_stay_cum` | points the pure strategies would have earned on the player's own cards, **within this run**, including this round. In Run 2 these are the numbers shown in the Track box |
| `switchbonus` | Σ (always-switch − always-stay points) over **all earlier rounds** (Run 1 period 1 up to the previous round, across both runs). It is 0 in the first round |
| `switchwon_prev` | 1 if switching would have won in the previous round (Run 2 period 1 uses Run 1 period 5); blank in the very first round |
| `decision_time_ms` | time from the reveal appearing to the Switch/Stay tap. If the page was reloaded during the decision, it's counted from the reload |
| `button_order` | `switch-left` or `stay-left`, randomised once per participant |

**`participants`** has one row per person. `comprehension_errors` is the total number of wrong answers in the quick check, counting each wrong question on each attempt. `manip_direct` is blank for Control. `total_points` is computed by the server from the `decisions` rows.

Group assignment alternates in order of registration (when the player presses Continue on the code-name page): 1st Control, 2nd Track, 3rd Control, 4th Track, and so on. It runs under a lock on the server, so two players registering at the same moment still get different slots. Pilot players have their own sequence, and **Delete pilot rows** restarts it. At any moment the two groups differ by at most 1 person.

## Local testing (optional, for whoever maintains the code)

Needs Node.js.

```bash
node tests/simulate.js
```

This runs 300,000 random rounds and checks that the revealed card is never the prize or the first pick, and that switching wins ≈ 2/3. It then has 3 pilot and 20 real fake players play through `Code.gs` against a mocked Sheet, tries about 30 invalid inputs, and recomputes every derived column (`cum_points`, the strategy sums, `switchbonus`, `switchwon_prev`) by brute force.

```bash
node tests/dev-server.js
```

This serves the whole site at <http://localhost:8787> with an in-memory "Sheet". The results page is at `/results.html?key=testkey`. To simulate an outage, open `/__offline?on=1`; `/__offline?on=0` ends it.

## Troubleshooting

- **"Not set up yet" on the phone:** `API_URL` in `config.js` is still the placeholder.
- **"Could not reach the server":** check the web app URL ends in `/exec` and that the deployment has *Who has access: Anyone*.
- **The results page says "Wrong admin key":** check the `?key=` value against the `ADMIN_KEY` Script Property. If the page remembered a wrong key, close the tab and open the link again.
- **You changed `Code.gs` but nothing changed:** you need a **new version** (Part D).
- **"⚠ save error" on a phone:** the server rejected a row. This should never happen in normal play. Note the code name and check the Sheet.
