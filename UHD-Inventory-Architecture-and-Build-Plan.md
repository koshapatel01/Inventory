# UHD IT PMO — Supply Inventory & Purchasing-Status Tracker
## Architecture & Build Plan

*Prepared for Kosha (UHD IT PMO). Stack: Smartsheet + Next.js + GitHub + Vercel.*

---

## 1. The plan in one paragraph

You keep your inventory data **in Smartsheet** — the tool UHD already trusts — and put a clean, custom **web app** on top of it so your operators get a fast, purpose-built screen instead of wrestling with a raw spreadsheet. The app is written in **Next.js** (one project that holds both the screens people see and the small bit of server code that talks to Smartsheet). The code lives on **GitHub**, and **Vercel** turns that code into a live website automatically every time you save changes. The **daily low-stock email** to ITPMO@UHD.EDU is handled by **Smartsheet's own alert rules**, so there's no extra automation for you to babysit.

---

## 2. Why Smartsheet stays the "database" (the decision you left to me)

You asked me to recommend how the app should use Smartsheet. My recommendation: **keep Smartsheet as the live source of truth** — the app reads from it and writes back to it. Here's the plain-language reasoning:

- **It sidesteps your old blocker.** The Supabase direction stalled on *UHD IT approval for external hosting*. Smartsheet is already inside your approved toolset, so there's nothing new for IT to vet on the data side. The web app itself holds **no inventory data** — it just displays and edits what's in Smartsheet.
- **It's the only option that fits your alert choice.** You chose Smartsheet's built-in alerts for the low-stock email. Those alerts can only watch data that lives *in Smartsheet*. If we moved the data elsewhere, that choice would stop working.
- **Your scale is tiny for Smartsheet.** ~100 SKUs and 3–5 operators is far below Smartsheet's API limits (it allows hundreds of API calls per minute). You will not feel any performance ceiling.
- **There's a safety net.** If the web app is ever down or mid-change, your team can still open Smartsheet directly and keep working. Nothing is locked inside custom code.

**The one trade-off to know:** Smartsheet is a spreadsheet, not a full database, so it doesn't enforce relationships or complex validation the way Postgres would. For a status-tracking tool with no approvals workflow, that limitation never bites. If the system later grows into something with multi-step workflows or thousands of rows, that's the moment to revisit a real database — not now.

---

## 3. How the pieces connect

```
   Operators (browser)
          │  click, type, update stock/status
          ▼
   ┌─────────────────────────────┐
   │  Next.js app on Vercel      │
   │  • Pages (the screens)      │
   │  • API routes (server code) │◄── holds the Smartsheet API token (secret)
   └─────────────┬───────────────┘
                 │  HTTPS + API token
                 ▼
   ┌─────────────────────────────┐
   │  Smartsheet (your data)     │
   │  • Inventory sheet (rows)   │
   │  • Built-in alert rules ────┼──► daily low-stock email → ITPMO@UHD.EDU
   └─────────────────────────────┘

   Your code lives in GitHub. Every save to GitHub → Vercel rebuilds the live site.
```

Read the flow as: **person → app → Smartsheet, and back.** The secret API token never leaves the server side of the app, so it's never exposed in anyone's browser.

---

## 4. Data model (your Smartsheet columns)

The app expects one Smartsheet sheet with these columns. You almost certainly have most of these already from the manual process — we just map the app to your exact column names in one config file (`lib/config.js`), so **you don't have to rename anything in Smartsheet.**

| Column (suggested name) | Type | Purpose |
|---|---|---|
| SKU | Text | Unique item code (e.g., UHDITFO10) |
| Item Name | Text | Human-readable name |
| Category | Dropdown | Office / Breakroom |
| Location | Dropdown | S755 / S821 / TLS |
| Quantity | Number | Current on-hand count |
| Minimum | Number | Reorder point (low-stock threshold) |
| Status | Dropdown | Purchasing status (e.g., OK / Low / Ordered / Received) |
| Last Updated | Date/System | When the row last changed |
| Notes | Text | Free-form notes |

**Low-stock rule:** an item is "low" when `Quantity ≤ Minimum`. The app highlights these visually; Smartsheet's alert rule uses the same idea to send the email.

Your three locations are already reflected as filter buttons in the app: **S755** (central purchasing & storage), **S821**, and **TLS**.

---

## 5. The daily low-stock email (Smartsheet built-in alerts)

No custom code — you set this up once inside Smartsheet. Click-by-click:

1. Open your inventory sheet in Smartsheet.
2. Top menu → **Automation** → **Create a workflow** → **When rows meet a condition, send an alert.** (Or start from a blank workflow.)
3. **Set the trigger:** run on a schedule — **Daily**, at a time you choose (e.g., 8:00 AM).
4. **Set the condition:** you want rows where stock is at or below the minimum. Smartsheet compares two columns via a helper column most reliably, so add a checkbox column named `Is Low` with a column formula: `=IF(Quantity@row <= Minimum@row, true, false)`. Then the condition becomes simply **`Is Low` is checked.**
5. **Set the action:** **Alert someone** → recipient **ITPMO@UHD.EDU** → include the fields SKU, Item Name, Location, Quantity, Minimum.
6. **Save** and give the workflow a name like "Daily low-stock alert."

That's the whole alerting system. It keeps running even if the web app is idle, which is exactly what you want.

> The web app also creates/maintains that `Is Low` value logically, but the **column formula above is what the Smartsheet alert depends on** — set it in Smartsheet so the alert is self-sufficient.

---

## 6. What you'll need to gather (one-time)

1. **A Smartsheet API access token.** In Smartsheet: your account icon → **Personal Settings** → **API Access** → **Generate new access token.** Copy it somewhere safe — you only see it once. (For a shared/production setup, generate it from a service account rather than a personal login if UHD provides one.)
2. **The Sheet ID** of your inventory sheet. Open the sheet → **File** → **Properties** → copy the **Sheet ID** number.
3. **A GitHub account** (free) and a new empty repository to hold the code.
4. **A Vercel account** (free Hobby tier is fine to start; UHD may prefer a Pro/Team account for an official tool) — sign in with your GitHub account so they're linked.

---

## 7. Setup steps (once the scaffold is in your hands)

Plain sequence — I'll expand any step into click-by-click when you get there:

1. **Put the code on your machine** and open the folder in VS Code.
2. **Install dependencies:** run `npm install` in the project folder.
3. **Create your secrets file:** copy `.env.example` to `.env.local` and paste in your `SMARTSHEET_API_TOKEN` and `SMARTSHEET_SHEET_ID`.
4. **Match the column names:** open `lib/config.js` and edit the column-title strings to match your Smartsheet exactly.
5. **Run it locally:** `npm run dev`, then open `http://localhost:3000`. You should see your live Smartsheet rows.
6. **Push to GitHub:** create the repo, then `git init`, commit, and push.
7. **Deploy to Vercel:** "Add New Project" → import the GitHub repo → paste the same two environment variables into Vercel's settings → **Deploy.** Vercel gives you a live URL.
8. **Set up the Smartsheet alert** (Section 5).
9. **Share the Vercel URL** with your operators.

From then on, editing the app is: change code → push to GitHub → Vercel redeploys automatically.

---

## 8. What the scaffold gives you (delivered alongside this plan)

- A working **inventory dashboard**: sortable table, filter by location and category, search, and clear **low-stock highlighting.**
- **Inline editing:** operators update **Quantity** and **Status** right in the table; changes save straight back to Smartsheet.
- A tidy **server layer** that keeps your Smartsheet token secret and handles read/write.
- One **config file** for column mapping, locations, and status options — so non-code changes stay easy.
- A **README** with the exact commands, and this plan for the big picture.

---

## 9. Open items & good next steps

- **Access control:** the scaffold ships open (anyone with the URL can view/edit), which is common for an internal single-team tool behind a shared link. If you want sign-in, the clean add-on is Vercel's password protection (Pro) or Microsoft/UHD SSO — a follow-up once the core works.
- **Service account token vs. personal token:** for an official tool, ask UHD IT whether there's a shared Smartsheet service account so the app isn't tied to your personal login.
- **Column formula for `Is Low`:** set this in Smartsheet so the alert is independent of the app.
- **UHD IT heads-up:** even though the data stays in Smartsheet, mention to IT that a Vercel-hosted internal page will read/write the sheet via API — so it's on record.

---

*Next: the code scaffold. Once you've reviewed both, tell me your real Smartsheet column names and I'll wire the config to match exactly.*
