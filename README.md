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
- **Excel export** (Activity → Export Excel): downloads exactly what the current filters show as `DhanFlow-transactions-<date>.xlsx`.
  - **Transactions** sheet: real dates and ₹ amounts with Money in / Money out columns, my share and split details, a frozen header, filter buttons on every column, and a total row.
  - **Summary** sheet: the filters used, entry count, money in/out/net, and spending by category.
- **Confirm dialogs**: deleting an entry or account, undoing a repayment, removing a budget and linking older entries ask in an in-app dialog (Cancel / Confirm) instead of the browser's pop-up. Destructive actions start focused on Cancel, and Escape cancels.
- **Collect page**: per-person balances, WhatsApp/copy reminder, "Got it" to mark paid (choose which account received the money).
- **Light / dark theme**: toggle in the top bar, in Settings, or press `T`. Saved per device.
- **Calculator**: press `C` anywhere; "Add ₹X" opens a new entry with that amount. Amount fields also accept maths (`1200+350`, `2400/3`, `500+10%`).
- **App lock** (Settings → App lock, or the padlock in the top bar): protect the app with a **pattern** (3×3, at least 4 dots) or a **4–8 digit PIN**.
  - Enforced by the server, not just hidden in the browser: every API call except `/health` and `/api/auth/*` needs an unlocked session, so refreshing the page, opening a URL directly or calling the API with no session gets nothing.
  - Asked **only when you open DhanFlow** (a new tab, window or browser start) **and after Lock now** (`L`, works as logout). Refreshing the page, switching tabs or apps, or leaving it idle doesn't lock it. Opening a second tab locks the first one until you enter the PIN in the new tab.
  - After unlocking, amounts start **hidden**; tap the eye (or `M`) to reveal them.
  - After 5 wrong tries, unlocking pauses for 30 s, then 1 min, 2 min… up to 15 min. The counter is stored in the DB, so restarting the server doesn't reset it.
  - Changing the pattern or PIN signs out every other device. The secret is stored only as a salted scrypt hash; the session cookie is `httpOnly`, `SameSite=Strict`, and only its SHA-256 is stored.
  - **Forgot it?** On the machine running the backend: `cd Backend && npm run reset-lock`. This removes the lock only; your data is untouched.
- **Hide amounts** (eye icon or `M`): masks every rupee figure, including chart axes, insights and notifications, for when someone is looking at your screen. WhatsApp reminders you send still contain the real amounts.
- **Shortcuts**: `N` new entry, `C` calculator, `H` home, `A` activity, `W` accounts, `P` collect, `B` budget, `T` theme, `M` hide amounts, `L` lock.

The reminder checks run on server start and every 30 minutes.

> The app lock is designed for a single owner. If you put DhanFlow on the internet, also serve it over HTTPS (the cookie is marked `Secure` when `NODE_ENV=production`) and set `CLIENT_ORIGIN` to your site's URL.

## Run locally

Requires Node 20+ and MongoDB running on `mongodb://127.0.0.1:27017` (change `MONGO_URI` in `Backend/.env` for Atlas).

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
| POST | `/transactions` | Create (`participants: [{ name, amount }]` to split a debit) |
| GET | `/transactions/:id` | Get one |
| PATCH | `/transactions/:id` | Partial update (paid participants are locked) |
| DELETE | `/transactions/:id` | Delete |
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
