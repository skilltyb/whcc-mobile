# WHCC Apps Script — Setup Guide

## 1. Create the Google Spreadsheet

Go to sheets.google.com and create a new spreadsheet named **WHCC Mobile**.
Copy the Spreadsheet ID from the URL:
```
https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit
```

## 2. Paste Code.gs into Apps Script

1. In the spreadsheet, go to **Extensions → Apps Script**
2. Delete any existing code in Code.gs
3. Paste the contents of `Code.gs` into the editor
4. Replace `'YOUR_SPREADSHEET_ID_HERE'` on line 13 with your actual Spreadsheet ID

## 3. Deploy as Web App

1. Click **Deploy → New deployment**
2. Select type: **Web app**
3. Execute as: **Me** (your Google account)
4. Who has access: **Anyone** (required for the mobile app to call it)
5. Click **Deploy** and copy the Web App URL

## 4. Update the App

In `index.html`, find line ~3282:
```js
var WHCC_SCRIPT_URL = 'https://script.google.com/macros/s/...';
```
Replace the URL with your new deployment URL.

## 5. Set Up the Members Sheet

Create a sheet named **Members** with these columns (row 1):

| Member # | First Name | Last Name | Name | Email | PIN | Role | Membership | Handicap |
|----------|-----------|-----------|------|-------|-----|------|-----------|---------|
| 1001 | Jane | Smith | Jane Smith | jane@email.com | 1234 | member | Full Golf | 14.2 |
| 9001 | Head | Pro | Head Pro | pro@whcc.com | 9999 | staff | Staff | 0 |
| 9002 | John | Doe | John Doe | john@whcc.com | 5678 | both | Staff | 5.1 |

**Role values:** `member` · `staff` · `both` (both = can switch between portals)

All other sheets (Registrations, Dining Reservations, League Regs, Photos)
are auto-created with headers on first use.

## 6. Sheets Reference

| Sheet | Purpose |
|-------|---------|
| Members | Login auth + member directory |
| Registrations | Event sign-ups |
| Dining Reservations | Table bookings |
| League Regs | League sign-up forms |
| Photos | Hero photo URLs for the member home screen |

## 7. Script Properties (auto-managed)

These keys are stored automatically by the app — no setup needed:

| Property key | Stores |
|-------------|--------|
| `conditions` | Course conditions object |
| `teesheets` | Tee sheet data by event/round |
| `live_scores` | Tournament scoring |
| `ops_pool_status` | Pool open/closed + notice |
| `ops_pool_guests` | Guest log |
| `ops_pool_chem` | Chemical log |
| `ops_work_orders` | Grounds work orders |
| `ops_spray_log` | Spray/chemical log |
| `ops_staff_messages` | Staff bulletin board |
| `ops_lost_found` | Lost & found log |
| `ops_incidents` | Incident reports |
| `ops_dining_res` | Dining reservations (live ops cache) |
| `ops_partners` | Partner posts |
| `ops_hole_status` | Hole-by-hole status |
| `ops_on_course` | Members currently on course |

## 8. Photos Sheet

Add public image URLs for the member home screen hero photo rotation:

| URL |
|-----|
| https://example.com/photo1.jpg |
| https://example.com/photo2.jpg |

Use Google Drive "Anyone with link" share links or any publicly accessible image URL.

## 9. Re-deploying After Changes

After editing Code.gs, always create a **New Deployment** (not "Manage deployments → edit").
Each new deployment gets a new URL. Update `WHCC_SCRIPT_URL` in `index.html` and bump
the SW cache version in `sw.js`.
