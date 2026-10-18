# DhanFlow · Dhanush's Money Advisor

Personal expense tracker: credits and debits, live balance, spending by category, split expenses with "mark as paid" repayments, monthly budgets, collection reminders, advisor insights and a built-in calculator.

- **Frontend**: React 19 + Vite + Tailwind CSS v4, TanStack Query, Recharts, Motion
- **Backend**: Node.js + Express 5 + MongoDB (Mongoose), zod validation

## Features

- **Advisor home**: greeting, money score (savings + budget + collections), and rule-based "What I noticed" insights.
- **Monthly budget**: overall and per-category limits. A month without its own budget inherits the latest earlier one. "Suggest" uses your 3-month average. Fixed costs (rent, bills, EMI, insurance, education, investment, subscriptions) are excluded from the daily-pace projection.
- **Notifications** (in-app and optional desktop alerts):
  - Budget at 80% and over 100%.
  - Overdue split shares, re-reminded every N days (Settings, default 7). Cleared when the person pays.
  - Month-end wrap-up: spending and who still owes you how much.
- **Accounts**: one per bank, card, wallet or cash pocket, each with an opening balance and its own live balance. Every entry records the account it used; **Transfer** moves money between your own accounts without counting as income or spending. Activity can be filtered by account. Accounts with history are archived rather than deleted. Entries from before accounts existed can be linked to an account in one click.
- **Export** (Activity → Export): downloads exactly what the current filters show, as Excel (`.xlsx`), CSV, PDF or Word (`.docx`).
  - **Transactions** sheet: real dates and ₹ amounts with Money in / Money out columns, my share and split details, a frozen header, filter buttons on every column, and a total row.
  - **Summary** sheet: the filters used, entry count, money in/out/net, and spending by category.
- **Confirm dialogs**: deleting an entry or account, undoing a repayment, removing a budget and linking older entries ask in an in-app dialog (Cancel / Confirm) instead of the browser's pop-up. Destructive actions start focused on Cancel, and Escape cancels.
- **Collect page**: per-person balances, WhatsApp/copy reminder, "Got it" to mark paid (choose which account received the money).
- **Light / dark theme**: toggle in the top bar, in Settings, or press `T`. Saved per device.
- **Voice entry and voice notes**: tap the 🎤 at the top of a new entry and say it, e.g. "spent 450 on petrol yesterday in cash", "paid 1200 for dinner split with Ravi and Anu", "received 50000 salary", "uber 2k last friday". Amount (2k, 1.5 lakh), money in or out, date (today, yesterday, 3 days ago, last Friday, 5th October), category, payment method (saying "cash" also picks your cash account), description and equal splits are filled in for you to check and save.
  - The recording is **saved with the entry** as a voice note (with its transcript). Play it from the 🎵 chip in Activity or in the entry's edit form, remove it with the bin, or record a new one when editing. Notes are stored in MongoDB, up to 1 MB each (about 2 minutes; recording stops by itself after 60 s).
  - Speech-to-text uses the browser's speech service when it works (Chrome, Edge, Safari), with live words as you speak. Where that service isn't reachable (Brave, Firefox, Opera, embedded browsers, or the "needs an internet connection" error), DhanFlow switches to **on-device transcription** with Whisper (`whisper-base.en`): free, no key, and nothing leaves your machine. The first time it downloads the model once (about 75 MB, cached by the browser); after that it stops listening by itself when you pause and turns the speech into text in a few seconds.
- **Calculator**: press `C` anywhere; "Add ₹X" opens a new entry with that amount. Amount fields also accept maths (`1200+350`, `2400/3`, `500+10%`).
- **App lock** (Settings → App lock, or the padlock in the top bar): protect the app with a **pattern** (3×3, at least 4 dots) or a **4–8 digit PIN**.
  - Enforced by the server, not just hidden in the browser: every API call except `/health` and `/api/auth/*` needs an unlocked session, so refreshing the page, opening a URL directly or calling the API with no session gets nothing.
  - Asked **only when you open DhanFlow** (a new tab, window or browser start) **and after Lock now** (`L`, works as logout). Refreshing the page, switching tabs or apps, or leaving it idle doesn't lock it. Opening a second tab locks the first one until you enter the PIN in the new tab.
  - After unlocking, amounts start **hidden**; tap the eye (or `M`) to reveal them.
  - After 5 wrong tries, unlocking pauses for 30 s, then 1 min, 2 min… up to 15 min. The counter is stored in the DB, so restarting the server doesn't reset it.
  - Changing the pattern or PIN signs out every other device. The secret is stored only as a salted scrypt hash; the session cookie is `httpOnly`, `SameSite=Strict`, and only its SHA-256 is stored.
  - **Forgot it?** On the machine running the backend: `cd Backend && npm run reset-lock`. This removes the lock only; your data is untouched.
- **Import from a file** (Activity → Import, the 📎 in Ask DhanFlow, or `I`): drop a bank or UPI-app statement, or your own list of expenses, and review every row before anything is saved.
  - Formats: PDF, Excel (`.xlsx`, `.xls`, `.ods`), CSV/TSV, Word (`.docx`) and plain text. Sheets and Word tables are matched by their headers (Date, Item, Where, Amount, Debit/Credit, Dr/Cr, Category, Paid by…), or by their contents when there is no header row. Free text like "Petrol 500 yesterday" works too.
  - Each entry needs an **amount** and what it was for; the date is optional. Rows without a date are set to today and marked to check, and the date is editable on every row. The review starts with a verdict: "Enough data: N entries ready", which columns were used, and which rows were left out and why. A file with no amounts says **Insufficient data** and lists the columns it found.
  - Reads netbanking passbooks (including Canara's layout, where the description sits above the date row), UPI-app histories (Supermoney's Name / Bank / Amount / Date / Status table), and the usual date-first layouts. Password-protected PDFs ask for the password, which is only used to open the file and is never stored.
  - Money in or out comes from the running balance when the statement has one, otherwise from signs, Dr/Cr and wording. Descriptions are cleaned from UPI strings (`UPI/DR/…/SWIGGY/…` → "Swiggy"), with the day, weekday and time shown to jog your memory.
  - Categories come from what you chose before for the same payee, then your past entries, then keywords. Anything unknown lands in **Needs a look**. Picking a category fills it in for the other rows with the same payee, and DhanFlow remembers it for next time.
  - Rows already imported are skipped (same UPI reference or same line), and rows that look like something you already saved (same amount and type within a day, added by hand or imported from another statement) start unticked. Importing the bank statement and the UPI app for the same month won't double count.
  - With AI on, it also suggests categories for unknown payees and can re-read a statement the rules couldn't make sense of.
- **Ask DhanFlow** (✨ Ask in the top bar, or `K`): ask about your money or tell it what to do, in plain words. Amounts in replies and charts are masked while amounts are hidden.
  - **Questions** ("where did my money go last month?") are answered from lookups of your data: totals, search, trends, top payees, accounts, money owed, budgets.
  - **Add entries**: "spent 250 on chai yesterday and got 2000 from Ravi for freelance work" saves both. If the amount or what it was for is missing, it asks for just that. Category, date (today), account (default) and splits are filled in or taken from what you say.
  - **Edit and delete**: "change the petrol one to 650, paid in cash". Every add or edit shows a card with **Undo**. Deleting only shows a Delete button; nothing is removed until you press it.
  - **Splits**: "Ravi paid me back for dinner" marks Ravi's share as paid and books the Split Repayment, exactly like **Mark paid** on Collect (it never adds it as plain income). Amounts that cover several shares are matched oldest first; if an amount doesn't match, it lists what's owed and asks. "Split the petrol with Kiran" adds a split to an existing entry; "Ravi didn't actually pay" re-opens it.
  - **Everything else you can do by hand**: transfers between your accounts ("withdrew 2000 from the ATM"), budgets ("food limit 6000"), and accounts ("add a Paytm wallet with 750", "make Cash the default", "archive the old card"). Each shows a card with Undo.
  - **Charts**: "chart my spending by category this month", "income vs spending for 6 months". Drawn in the chat from real data (donut, bars or trend; switchable), grouped by category, day, week, month, payee, person, account or payment method.
  - **Split charts**: "chart who owes me, when they paid and how fast" draws what each person paid back vs still owes, average days to pay back, how long pending shares have been waiting, and repayments over time, plus a table of every share with bill date, paid date and days taken. For anything the built-in charts don't cover, it draws a custom chart from numbers it looked up.
  - **Tables**: "show my splits", "budget vs spent this month", "monthly summary for this year" show a table in the chat (transactions, split shares, people, accounts, budget, categories or monthly), with CSV, Excel, PDF and Word buttons.
  - **Exports**: "export last month's food expenses as PDF", "download who owes me as a Word file". Any of those reports, in Excel (`.xlsx`), CSV, PDF or Word (`.docx`), with the filters you asked for and a button to download again. PDFs write amounts as "Rs" (the built-in PDF fonts have no ₹ sign).
  - **Chart downloads**: every chart card has a download button: image (`.png`), vector (`.svg`) or the numbers behind it (`.csv`). Images include the title, totals and legend.
  - **Reminders**: "remind Ravi about what he owes" writes the WhatsApp message with every pending share and total, with **Send on WhatsApp** and **Copy** buttons.
  - **Settings and notifications**: "call me Dhanu", "remind me every 3 days about overdue splits", "turn off the month-end summary" (with Undo); "any new notifications?", "mark all as read", "check for reminders now", "clear read notifications".
  - **Deleting**: "delete the Old Wallet account" and "remove this month's budget" only show a confirm button; nothing is removed until you press it. Accounts with entries are suggested for archiving instead.
  - **App controls**: "switch to light mode", "hide my amounts", "lock the app", "open the budget page", "open the calculator", "open settings", "set up a PIN", "open the add form for 500 groceries". The AI never sees or changes your PIN or pattern.
  - **Voice**: the 🎤 button next to Send types what you say into the chat. Needs microphone permission; uses the browser's speech service or, where that isn't available, on-device Whisper (see Voice entry above).
  - Chats are saved in this browser (🕘 for past chats, ✏️ for a new one). The 📎 button opens a file in the importer.
  - Needs a free AI key: set `AI_API_KEY` in `Backend/.env` (Gemini by default; Groq or a local Ollama also work, see `Backend/.env.example`). Without a key the panel explains how to turn it on and everything else works as usual.
  - Free tiers are small (Gemini's free `gemini-3.8-flash` allows about 20 requests a day; a question takes 1–3, an add/edit/export takes 1–2). When it runs out, the backend switches to `gemini-3.1-flash-lite` (its own free quota, about 500 a day) until the daily reset at midnight Pacific time; change this with `AI_FALLBACK_MODELS`. For heavier use, Groq's free tier allows far more: `AI_PROVIDER=groq` with a key from console.groq.com.
  - Privacy: what you ask, the data the AI looks up to answer, and the text of a file the AI reads are sent to the AI provider you configure. Rule-based import never leaves your machine. Saved chats live in this browser's local storage; delete them from the chat list.
- **Hide amounts** (eye icon or `M`): masks every rupee figure, including chart axes, insights and notifications, for when someone is looking at your screen. WhatsApp reminders you send still contain the real amounts.
- **Shortcuts**: `N` new entry, `C` calculator, `H` home, `A` activity, `W` accounts, `P` collect, `B` budget, `T` theme, `M` hide amounts, `L` lock, `I` import a file, `K` Ask DhanFlow.

The reminder checks run on server start and every 30 minutes.

> The app lock is designed for a single owner. If you put DhanFlow on the internet, also serve it over HTTPS (the cookie is marked `Secure` when `NODE_ENV=production`) and set `CLIENT_ORIGIN` to your site's URL.

## Run locally

Requires Node 22.13+ (PDF import needs it; set the same on your host) and MongoDB running on `mongodb://127.0.0.1:27017` (change `MONGO_URI` in `Backend/.env` for Atlas).

```bash
# terminal 1
cd Backend
npm install
npm run dev        # http://localhost:5000/api

# terminal 2
cd Frontend
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so no CORS setup is needed in development.

## How money is calculated

| Figure | Meaning |
| --- | --- |
| Balance | Sum of account opening balances + all credits − all debits (all time) |
| Account balance | Opening balance + credits − debits − transfers out + transfers in |
| Income | Credits in the period, excluding split repayments |
| Total spent | Full amount of debits in the period |
| My actual spending | Debits minus the parts other people owe you |
| To collect | Unpaid split shares |

When you split a debit, each person's share is stored on the transaction. Marking a share as **paid** creates a `Split Repayment` credit, which raises your balance. Undoing it (or deleting that repayment) removes the credit and re-opens the debt. Deleting a split expense also deletes its repayments.

## API

Base URL: `/api`. When the app lock is on, every route except `/health` and the public `/auth/*` routes returns `401 { code: 'LOCKED' }` without a valid session cookie.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Server and DB status (public) |
| GET | `/auth/status` | `{ configured, method, authenticated, retryAfter? }` (public) |
| POST | `/auth/setup` | Turn on the lock: `{ method: 'pin'\|'pattern', secret }` (public, only while no lock exists) |
| POST | `/auth/unlock` | `{ secret }` → sets the session cookie; 401 `BAD_SECRET` with `attemptsLeft`, 429 `THROTTLED` with `retryAfter` (public) |
| POST | `/auth/lock` | Ends this session (public) |
| PATCH | `/auth/settings` | Change the secret: `{ currentSecret, method, secret }` |
| DELETE | `/auth/setup` | Remove the lock: `{ currentSecret }` |
| GET | `/summary?from&to&months` | Balance, period totals, category breakdown, monthly trend, recent |
| GET | `/categories` | Categories in use, by type |
| GET | `/transactions?type&category&search&from&to&split&account&page&limit&sort` | Paginated list + totals for the filter (`type` can be `transfer`; `account=none` = not linked) |
| GET | `/transactions/export?...` | Streams the filtered list as an Excel workbook (`.xlsx`, same filters as the list) |
| GET | `/reports/:report?format=json\|xlsx\|csv\|pdf\|docx&from&to&type&category&search&split&account&person&status&month&sort` | `report` is `transactions`, `splits`, `people`, `accounts`, `budget`, `categories` or `monthly`. JSON gives `{ title, subtitle, columns, rows, count }`; the other formats download a file (up to 20,000 rows) |
| POST | `/transactions` | Create (`participants: [{ name, amount }]` to split a debit) |
| GET | `/transactions/:id` | Get one |
| PATCH | `/transactions/:id` | Partial update (paid participants are locked) |
| DELETE | `/transactions/:id` | Delete (also deletes its voice note) |
| PUT | `/transactions/:id/voice` | Attach or replace the voice note. Raw audio body (`Content-Type: audio/*`, max 1 MB), `?duration=&transcript=`. Sets `voiceNote: { duration, transcript, size }` on the entry |
| GET | `/transactions/:id/voice` | The recording, with its original content type |
| DELETE | `/transactions/:id/voice` | Remove the voice note |
| GET | `/splits?status=pending\|paid\|all&person` | Flattened split shares |
| GET | `/splits/people` | Per-person totals: owed, paid, pending |
| PATCH | `/splits/:transactionId/participants/:participantId/pay` | Mark paid (body: `{ date?, paymentMethod?, account? }`, account defaults to the bill's) |
| PATCH | `/splits/:transactionId/participants/:participantId/unpay` | Undo payment |
| GET | `/accounts` | Accounts with balance, this month's in/out, entry count; plus `unassigned` and `total` |
| POST | `/accounts` | Create (`{ name, type?, openingBalance?, color?, isDefault? }`) |
| PATCH | `/accounts/:id` | Update, set default, archive/restore (`{ archived }`) |
| DELETE | `/accounts/:id` | Delete (only accounts with no entries) |
| POST | `/accounts/:id/assign-unassigned` | Link all entries without an account to this one |
| GET | `/budgets/:month` | Budget status for `YYYY-MM` (limits, spent, projection, safe daily spend, suggestion) |
| PUT | `/budgets/:month` | Save budget (`{ total, categories: [{ category, limit }] }`) |
| DELETE | `/budgets/:month` | Remove that month's budget |
| GET | `/insights` | Advisor headline, money score, stats and insights |
| GET | `/notifications?unread&limit` | Notifications + unread count |
| POST | `/notifications/check` | Run reminder checks now |
| PATCH | `/notifications/read-all` | Mark all read |
| PATCH | `/notifications/:id/read` | Mark one read |
| DELETE | `/notifications/read` | Clear read notifications |
| DELETE | `/notifications/:id` | Delete one |
| GET | `/settings` | Name, reminder interval, month-end toggle |
| PATCH | `/settings` | Update settings |
| POST | `/import/preview` | Multipart: `file` (PDF, xlsx/xls/ods, csv/tsv, docx or txt; up to 15 MB), `password?` (PDF only), `ai=off\|auto\|force`. Returns `{ source, format, formatLabel, pages?, rows, categories, summary: { ready, skipped, skippedRows, found, verdict }, ai, warnings }`; saves nothing. 400 `PASSWORD_REQUIRED` / `WRONG_PASSWORD` / `NO_ROWS` (with `columns` and `skipped` explaining what's missing) |
| POST | `/import/commit` | `{ account?, rows: [{ date, type, amount, category, description?, paymentMethod?, importRef?, learnKey? }] }` → `{ imported, skipped, learned }` |
| GET | `/ai/status` | `{ enabled, provider, model }` |
| POST | `/ai/chat` | `{ messages: [{ role: 'user'\|'assistant', content }] }` (last one from the user) → `{ reply, toolsUsed, actions, memo }`. `actions` are cards to render: `created`, `updated` (with `undo` fields), `confirm_delete`, `split`, `budget`, `account` (each with undo data), `chart` (`{ chart, title, series, data, total }`), `table` (a report plus its `params`), `export` (`{ report, format, params }` for `/reports/:report`), `settings` (with `undo`), `confirm` (`kind`: `delete_account`, `remove_budget` or `clear_notifications`; nothing happens until the user confirms), `notifications`, `remind` (`{ person, amount, count, text }`), `app` (`{ command, page?, prefill? }`, run by the browser). Send `memo` back in brackets after that reply's content so follow-ups know the entry ids. 503 `AI_DISABLED`, 429 `AI_RATE_LIMIT` |

Example:

```json
POST /api/transactions
{
  "type": "debit",
  "amount": 2400,
  "category": "Food",
  "description": "Pizza night",
  "date": "2026-10-04",
  "paymentMethod": "upi",
  "participants": [
    { "name": "Ravi", "amount": 800 },
    { "name": "Priya", "amount": 800 }
  ]
}
```
