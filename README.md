# 🚣 Rowboat

Rowboat is a Trello Power-Up that turns CSV rows into Trello cards. Map each
column to any card field, custom field, or checklist, review the data before
importing, and save your mapping for next time.

It adds a **Rowboat** button to the board header. Upload a CSV, choose a Trello
field for each column, review the check, and every row becomes a card.

## Supported fields

Card fields: List, Labels, Members, Card Name, Card Description, Due Date,
Start Date, Location, URL (added as an attachment), Latitude/Longitude.
Custom Fields: every custom field on the board (text, number, date, checkbox, dropdown).
Checklist fields: Checklist Name, Checklist Item Name, Checklist Item Due Date,
Checklist Item Member.

Each Trello field can be used by one column only; fields already taken show
"(Connected: column)" in the dropdown.

## Checklists

Turn on "Merge rows with the same card name and list into one card", then use
one row per checklist item. Rows with the same Card Name + List become one
card; the first non-empty value wins for single fields, labels and members are
combined. A row with an empty Card Name continues the previous card.
Item due dates and assignees need a paid Trello plan; on free boards items are
still added, with a note in the log.

## Setup (about 10 minutes)

1. Host this folder on any HTTPS static host (GitHub Pages, Netlify, Vercel…).
   Example: `https://you.github.io/rowboat/`
2. Go to https://trello.com/power-ups/admin, choose your Workspace and
   **New** Power-Up. Iframe connector URL = the URL of `index.html`.
3. In the Power-Up's **API key** tab, generate a key. Add your hosting origin
   (e.g. `https://you.github.io`) to **Allowed origins**.
4. Paste the key into `config.js` (`APP_KEY`), redeploy.
5. In **Capabilities**, enable **Board buttons**.
6. On your board: Power-Ups → Custom → add your Power-Up.
7. Click **Rowboat**, then **Connect to Trello** the first time.

## Notes

- Lists, labels and members are matched by name, case and accents ignored.
  Members match by username (with or without @) or full name.
- Missing lists and labels can be created automatically (toggle in options).
- Dates: `17 Nov 26`, `17.11.2026`, `2026-11-17`, `11/17/2026`, French month
  names, optional time (`18:30`, `18h30`). Pick the order when ambiguous.
- Location is stored as the card's address; Trello only shows a map pin when
  Latitude/Longitude is also mapped.
- The mapping is saved per board and re-applied automatically to any CSV with
  the same columns (e.g. next month's meetup file).
- Requests are throttled to stay under Trello's limit (100 per 10 seconds).

## Security

No secrets live in this repository. `config.js` only holds a placeholder for
the Trello API key, which is a public identifier anyway (it is sent from the
browser). Never commit a Trello **API secret** or a user **token**: each user's
token is obtained at runtime through "Connect to Trello" and stored by Trello,
not by this code.
