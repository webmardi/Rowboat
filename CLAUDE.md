# Rowboat – project context for Claude Code

Rowboat is a Trello Power-Up that imports CSV rows as Trello cards, with a
column-to-field mapping screen. Repo: https://github.com/webmardi/Rowboat
Hosted on GitHub Pages: https://webmardi.github.io/Rowboat/ (case-sensitive).

## Stack

Plain static site, no build step, no npm dependencies at runtime.
- `index.html` + `connector.js`: iframe connector, registers the `board-buttons`
  capability ("Rowboat" button that opens the modal).
- `import.html` + `import.js` + `import.css`: the modal (auth, upload, mapping,
  validation, import). PapaParse 5.4.1 from cdnjs, Trello client lib from
  `p.trellocdn.com/power-up.min.js`.
- `config.js`: `APP_KEY` (Trello API key, public identifier), `APP_NAME`, `APP_AUTHOR`.

## How it works

- Auth: `t.getRestApi().authorize({ scope: 'read,write' })`, token from Trello at runtime.
- Board data (lists, labels, members, custom fields) loaded via REST `/1/boards/{id}/…`.
- Supported fields: List, Labels, Members, Card Name, Card Description, Due Date,
  Start Date, Location, URL (urlSource attachment), Latitude/Longitude, all
  Custom Fields (text, number, date, checkbox, list), Checklist Name / Item Name /
  Item Due Date / Item Member.
- One field per column; taken fields show "(Connected: column)".
- "Merge rows" option groups rows by Card Name + List (needed for checklists).
- Requests throttled to ~110 ms apart with retry on HTTP 429.
- Mapping saved per board in `t.set('board','private','csvImportMappings')`,
  keyed by normalized header signature, last 5 kept (4096-char limit).

## Rules

- NEVER commit secrets: no Trello API secret, no user tokens, no `.env`.
  The API key in `config.js` is OK to commit (it is public by design).
- Keep it dependency-free and buildless so GitHub Pages serves it as is.
- UI copy: sentence case, plain verbs, errors say what happened and how to fix it.
- Support light and dark mode via the CSS variables in `import.css`.

## Test data

`202701_Meetup_Todo's [draft] - Tâches.csv` (not in repo): 26 rows, columns
Card name, List, Due Date (`17 Nov 26`), Who, Members (Trello usernames),
Labels, Description.

## Possible next steps

- Set the real `APP_KEY` in `config.js` once the Power-Up exists in the admin portal.
- Local dev: serve with `npx http-server -p 8080 --cors` and use an ngrok/
  cloudflared HTTPS tunnel as a temporary connector URL.
- Add a "Download a template CSV" link and an undo ("Archive the cards just imported").
- Prepare the public directory listing: overview, description, icon, privacy policy page.
