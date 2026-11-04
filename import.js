/* global TrelloPowerUp, Papa, CONFIG */
'use strict';

const t = TrelloPowerUp.iframe({
  appKey: CONFIG.APP_KEY,
  appName: CONFIG.APP_NAME,
  appAuthor: CONFIG.APP_AUTHOR
});
const API = 'https://api.trello.com/1';
const STORAGE_KEY = 'csvImportMappings';

/* ------------------------------------------------------------------ */
/* Field catalogue                                                     */
/* ------------------------------------------------------------------ */

const CARD_FIELDS = [
  { id: 'list',     label: 'List',               aliases: ['list', 'status', 'column', 'liste', 'statut'] },
  { id: 'labels',   label: 'Labels',             aliases: ['labels', 'label', 'tags', 'tag', 'étiquettes', 'etiquettes', 'role'], multi: true },
  { id: 'members',  label: 'Members',            aliases: ['members', 'member', 'assignee', 'assignees', 'membres', 'username'], multi: true },
  { id: 'name',     label: 'Card Name',          aliases: ['card name', 'name', 'title', 'task', 'card', 'titre', 'tâche', 'tache', 'nom'] },
  { id: 'desc',     label: 'Card Description',   aliases: ['description', 'desc', 'details', 'notes'] },
  { id: 'due',      label: 'Due Date',           aliases: ['due date', 'due', 'deadline', 'échéance', 'echeance'], date: true },
  { id: 'start',    label: 'Start Date',         aliases: ['start date', 'start', 'début', 'debut'], date: true },
  { id: 'location', label: 'Location',           aliases: ['location', 'address', 'lieu', 'adresse'] },
  { id: 'url',      label: 'URL',                aliases: ['url', 'link', 'lien'] },
  { id: 'coords',   label: 'Latitude, Longitude', aliases: ['latitude, longitude', 'coordinates', 'coords', 'lat long', 'gps'] }
];
const CHECKLIST_FIELDS = [
  { id: 'cl_name',   label: 'Checklist Name',         aliases: ['checklist', 'checklist name'] },
  { id: 'cl_item',   label: 'Checklist Item Name',    aliases: ['checklist item', 'checklist item name', 'item'] },
  { id: 'cl_due',    label: 'Checklist Item Due Date', aliases: ['checklist item due date', 'item due'], date: true },
  { id: 'cl_member', label: 'Checklist Item Member',  aliases: ['checklist item member', 'item member'] }
];
const LABEL_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'];

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  token: null,
  board: null,      // { id, name, lists, labels, members, customFields }
  file: null,       // { name, headers, rows }
  mapping: {},      // header -> fieldId ('' = no field)
  plan: null
};

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(screen) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + screen;
  t.sizeTo('#app').catch(() => {});
}

function fieldById(id) {
  if (!id) return null;
  if (id.startsWith('cf:')) {
    const cf = state.board.customFields.find((c) => 'cf:' + c.id === id);
    return cf ? { id, label: cf.name, cf } : null;
  }
  return CARD_FIELDS.concat(CHECKLIST_FIELDS).find((f) => f.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* Trello REST with simple rate limiting (Trello: 100 req / 10 s)      */
/* ------------------------------------------------------------------ */

let lastCall = 0;
async function trello(method, path, body) {
  const wait = Math.max(0, lastCall + 110 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url = new URL(API + path);
  url.searchParams.set('key', CONFIG.APP_KEY);
  url.searchParams.set('token', state.token);
  const opts = { method, headers: {} };
  if (body && method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, opts);
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(text || res.statusText);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }
  throw new Error('Trello is rate-limiting requests. Wait a minute and try again.');
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  const api = t.getRestApi();
  try {
    if (await api.isAuthorized()) {
      state.token = await api.getToken();
      return loadBoard();
    }
  } catch (e) { /* fall through to auth screen */ }
  show('auth');
}

$('btn-auth').addEventListener('click', async () => {
  $('auth-error').hidden = true;
  try {
    state.token = await t.getRestApi().authorize({ scope: 'read,write', expiration: 'never' });
    await loadBoard();
  } catch (e) {
    $('auth-error').textContent = 'Trello didn’t grant access. Try again, and check that this Power-Up’s URL is listed in your API key’s allowed origins.';
    $('auth-error').hidden = false;
  }
});

async function loadBoard() {
  const { board: boardId } = t.getContext();
  const [board, lists, labels, members, customFields] = await Promise.all([
    trello('GET', `/boards/${boardId}?fields=name`),
    trello('GET', `/boards/${boardId}/lists?filter=open&fields=name,pos`),
    trello('GET', `/boards/${boardId}/labels?fields=name,color&limit=1000`),
    trello('GET', `/boards/${boardId}/members?fields=username,fullName`),
    trello('GET', `/boards/${boardId}/customFields`).catch(() => [])
  ]);
  state.board = { id: boardId, name: board.name, lists, labels, members, customFields };
  $('board-name').textContent = board.name;
  fillFallbackLists();
  show('upload');
}

function fillFallbackLists() {
  $('opt-fallback-list').innerHTML = state.board.lists
    .map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

const drop = $('drop');
$('file').addEventListener('change', (e) => e.target.files[0] && readFile(e.target.files[0]));
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
$('btn-change-file').addEventListener('click', () => { $('file').value = ''; show('upload'); });

function readFile(file) {
  $('upload-error').hidden = true;
  Papa.parse(file, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    complete: async (res) => {
      const headers = (res.meta.fields || []).filter((h) => h !== '');
      if (!headers.length || !res.data.length) {
        $('upload-error').textContent = 'This file has no header row or no data rows. The first row must contain the column names.';
        $('upload-error').hidden = false;
        return;
      }
      state.file = { name: file.name, headers, rows: res.data };
      await initMapping();
      renderMapping();
      show('map');
    },
    error: (err) => {
      $('upload-error').textContent = 'The file couldn’t be read: ' + err.message;
      $('upload-error').hidden = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

function signature(headers) { return headers.map(norm).join('|'); }

async function initMapping() {
  const { headers } = state.file;
  const saved = (await t.get('board', 'private', STORAGE_KEY).catch(() => null)) || {};
  const preset = saved[signature(headers)];
  state.mapping = {};

  if (preset) {
    for (const h of headers) {
      const f = preset.mapping[h];
      state.mapping[h] = f && fieldById(f) ? f : '';
    }
    applyOptions(preset.options || {});
    return;
  }

  // Auto-detect: exact label, then alias, then custom field name.
  const taken = new Set();
  for (const h of headers) {
    const n = norm(h);
    let match = '';
    for (const f of CARD_FIELDS.concat(CHECKLIST_FIELDS)) {
      if (taken.has(f.id)) continue;
      if (norm(f.label) === n || f.aliases.includes(n)) { match = f.id; break; }
    }
    if (!match) {
      const cf = state.board.customFields.find((c) => norm(c.name) === n && !taken.has('cf:' + c.id));
      if (cf) match = 'cf:' + cf.id;
    }
    if (match) taken.add(match);
    state.mapping[h] = match;
  }
  $('opt-group').checked = [...taken].some((id) => id.startsWith('cl_'));
}

function applyOptions(o) {
  if (o.dateFormat) $('opt-date-format').value = o.dateFormat;
  if (o.defaultTime) $('opt-default-time').value = o.defaultTime;
  if (o.separator) $('opt-separator').value = o.separator;
  if (o.position) $('opt-position').value = o.position;
  if (typeof o.createLists === 'boolean') $('opt-create-lists').checked = o.createLists;
  if (typeof o.createLabels === 'boolean') $('opt-create-labels').checked = o.createLabels;
  if (typeof o.group === 'boolean') $('opt-group').checked = o.group;
  if (o.fallbackListId && state.board.lists.some((l) => l.id === o.fallbackListId)) $('opt-fallback-list').value = o.fallbackListId;
}

function readOptions() {
  return {
    dateFormat: $('opt-date-format').value,
    defaultTime: $('opt-default-time').value || '09:00',
    separator: $('opt-separator').value || ',',
    position: $('opt-position').value,
    createLists: $('opt-create-lists').checked,
    createLabels: $('opt-create-labels').checked,
    group: $('opt-group').checked,
    fallbackListId: $('opt-fallback-list').value
  };
}

function samplesFor(header) {
  const vals = [];
  for (const r of state.file.rows) {
    const v = String(r[header] ?? '').trim();
    if (v && !vals.includes(v)) vals.push(v);
    if (vals.length === 3) break;
  }
  return vals;
}

function optionHtml(f, header) {
  const owner = Object.keys(state.mapping).find((h) => h !== header && state.mapping[h] === f.id);
  const selected = state.mapping[header] === f.id ? ' selected' : '';
  const disabled = owner ? ' disabled' : '';
  const text = owner ? `${f.label} (Connected: ${owner})` : f.label;
  return `<option value="${esc(f.id)}"${selected}${disabled}>${esc(text)}</option>`;
}

function renderMapping() {
  const { name, headers, rows } = state.file;
  $('file-name').textContent = name;
  $('file-summary').innerHTML = `${rows.length} row${rows.length === 1 ? '' : 's'}, ${headers.length} column${headers.length === 1 ? '' : 's'}.<br>Pick a Trello field for each column, or leave it as No Field to skip it.`;

  const cfs = state.board.customFields;
  $('map-rows').innerHTML = headers.map((h, i) => {
    const samples = samplesFor(h);
    const cfGroup = cfs.length
      ? cfs.map((c) => optionHtml({ id: 'cf:' + c.id, label: c.name }, h)).join('')
      : '<option disabled>No custom fields on this board</option>';
    return `
      <div class="map-row" role="row">
        <span class="col-name" role="cell">${esc(h)}<span class="badge" id="badge-${i}" hidden></span></span>
        <span role="cell">
          <select data-header="${esc(h)}" aria-label="Trello field for ${esc(h)}" class="${state.mapping[h] ? 'mapped' : ''}">
            <option value=""${state.mapping[h] ? '' : ' selected'}>No Field</option>
            <optgroup label="Card Fields">${CARD_FIELDS.map((f) => optionHtml(f, h)).join('')}</optgroup>
            <optgroup label="Custom Fields">${cfGroup}</optgroup>
            <optgroup label="Checklist Fields">${CHECKLIST_FIELDS.map((f) => optionHtml(f, h)).join('')}</optgroup>
          </select>
        </span>
        <span class="samples" role="cell">${samples.length
          ? samples.map((s) => `<span class="sample" title="${esc(s)}">${esc(s)}</span>`).join('')
          : '<span class="sample empty">empty</span>'}</span>
      </div>`;
  }).join('');

  for (const sel of $('map-rows').querySelectorAll('select')) {
    sel.addEventListener('change', (e) => {
      const before = Object.values(state.mapping).some((id) => id.startsWith('cl_'));
      state.mapping[e.target.dataset.header] = e.target.value;
      const after = Object.values(state.mapping).some((id) => id.startsWith('cl_'));
      if (!before && after) $('opt-group').checked = true;
      renderMapping();
    });
  }
  refreshOptions();
  validate();
}

function refreshOptions() {
  const ids = Object.values(state.mapping);
  const has = (pred) => ids.some(pred);
  const visible = {
    'list-fallback': true,
    date: has((id) => fieldById(id)?.date || (id.startsWith('cf:') && fieldById(id)?.cf.type === 'date')),
    multi: has((id) => id === 'labels' || id === 'members'),
    position: true,
    list: ids.includes('list'),
    labels: ids.includes('labels'),
    group: true
  };
  for (const el of document.querySelectorAll('[data-show]')) el.hidden = !visible[el.dataset.show];
}

for (const id of ['opt-date-format', 'opt-default-time', 'opt-separator', 'opt-position', 'opt-create-lists', 'opt-create-labels', 'opt-group', 'opt-fallback-list']) {
  $(id).addEventListener('change', validate);
  $(id).addEventListener('input', validate);
}

/* ------------------------------------------------------------------ */
/* Value parsing                                                       */
/* ------------------------------------------------------------------ */

const MONTHS = {
  jan: 0, january: 0, janv: 0, janvier: 0,
  feb: 1, february: 1, fev: 1, fevr: 1, fevrier: 1,
  mar: 2, march: 2, mars: 2,
  apr: 3, april: 3, avr: 3, avril: 3,
  may: 4, mai: 4,
  jun: 5, june: 5, juin: 5,
  jul: 6, july: 6, juil: 6, juillet: 6,
  aug: 7, august: 7, aou: 7, aout: 7,
  sep: 8, sept: 8, september: 8, septembre: 8,
  oct: 9, october: 9, octobre: 9,
  nov: 10, november: 10, novembre: 10,
  dec: 11, december: 11, decembre: 11
};

function parseDate(raw, fmt, defaultTime) {
  let s = String(raw ?? '').trim();
  if (!s) return { empty: true };

  let hh, mm;
  const tm = s.match(/(\d{1,2})[:h](\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?/i);
  if (tm) {
    hh = +tm[1]; mm = +tm[2];
    const ap = tm[3] && tm[3].toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    s = s.replace(tm[0], ' ');
  } else {
    [hh, mm] = defaultTime.split(':').map(Number);
  }
  s = s.replace(/(Z|[+-]\d{2}:?\d{2})\s*$/i, ' ');

  const parts = s.split(/[\s/\-.,T]+/).filter(Boolean);
  const nums = parts.filter((p) => /^\d+$/.test(p));
  const monthWord = parts.map((p) => MONTHS[norm(p).replace(/\.$/, '')]).find((m) => m !== undefined);
  let y, mo, d;

  if (monthWord !== undefined) {
    if (nums.length < 2) return { error: true };
    mo = monthWord;
    if (nums[0].length === 4) { y = +nums[0]; d = +nums[1]; } else { d = +nums[0]; y = +nums[1]; }
  } else {
    if (nums.length < 3) return { error: true };
    let f = fmt;
    if (f === 'auto') {
      if (nums[0].length === 4) f = 'YMD';
      else if (+nums[0] > 12) f = 'DMY';
      else if (+nums[1] > 12) f = 'MDY';
      else f = 'DMY';
    }
    if (f === 'YMD') { y = +nums[0]; mo = +nums[1] - 1; d = +nums[2]; }
    else if (f === 'MDY') { mo = +nums[0] - 1; d = +nums[1]; y = +nums[2]; }
    else { d = +nums[0]; mo = +nums[1] - 1; y = +nums[2]; }
  }
  if (y < 100) y += 2000;
  const date = new Date(y, mo, d, hh || 0, mm || 0);
  if (isNaN(date) || date.getMonth() !== mo || date.getDate() !== d) return { error: true };
  return { date };
}

const TRUE_WORDS = ['true', 'yes', 'y', '1', 'x', 'oui', 'ja', 'si', 'done', '✓', '✔'];
const FALSE_WORDS = ['false', 'no', 'n', '0', 'non', 'nein', ''];

function splitMulti(v, sep) {
  return String(v ?? '').split(sep).map((x) => x.trim()).filter(Boolean);
}

function findMember(value) {
  const v = norm(value).replace(/^@/, '');
  return state.board.members.find((m) => norm(m.username) === v || norm(m.fullName) === v || m.id === value);
}

function findList(value) {
  const v = norm(value);
  return state.board.lists.find((l) => norm(l.name) === v);
}

function findLabel(value) {
  const v = norm(value);
  return state.board.labels.find((l) => norm(l.name) === v) ||
         state.board.labels.find((l) => !l.name && norm(l.color) === v);
}

/* ------------------------------------------------------------------ */
/* Validation → import plan                                            */
/* ------------------------------------------------------------------ */

function validate() {
  if (!state.file) return;
  refreshOptions();
  const o = readOptions();
  const m = state.mapping;
  const colOf = {}; // fieldId -> header
  for (const [h, f] of Object.entries(m)) if (f) colOf[f] = h;

  const issues = [];      // { row, level, text, col }
  const newLists = new Map();
  const newLabels = new Map();
  const cards = [];
  const byKey = new Map();
  const fallbackList = state.board.lists.find((l) => l.id === o.fallbackListId);
  const add = (row, level, col, text) => issues.push({ row, level, col, text });

  if (!colOf.name) add(null, 'err', null, 'Map one column to Card Name. Every card needs a name.');
  if (!state.board.lists.length && !(colOf.list && o.createLists)) add(null, 'err', null, 'This board has no lists. Create a list first, or map a List column with “Create lists” turned on.');

  if (colOf.name) state.file.rows.forEach((r, i) => {
    const rowNo = i + 2; // spreadsheet row number (header is row 1)
    const get = (fid) => (colOf[fid] ? String(r[colOf[fid]] ?? '').trim() : '');
    const name = get('name');
    if (!name) {
      const hasChecklist = get('cl_item');
      if (!(o.group && hasChecklist && cards.length)) { add(rowNo, 'warn', colOf.name, 'No card name, row skipped.'); return; }
    }

    // List
    let list = null;
    const listVal = get('list');
    if (listVal) {
      const found = findList(listVal);
      if (found) list = { id: found.id, name: found.name };
      else if (o.createLists) { newLists.set(norm(listVal), listVal); list = { newName: listVal, name: listVal }; }
      else { add(rowNo, 'warn', colOf.list, `List “${listVal}” doesn’t exist, card goes to “${fallbackList?.name}”.`); }
    }
    if (!list && fallbackList) list = { id: fallbackList.id, name: fallbackList.name };

    // Labels
    const labels = [];
    for (const lv of splitMulti(get('labels'), o.separator)) {
      const found = findLabel(lv);
      if (found) labels.push({ id: found.id, name: found.name || found.color });
      else if (o.createLabels) { newLabels.set(norm(lv), lv); labels.push({ newName: lv, name: lv }); }
      else add(rowNo, 'warn', colOf.labels, `Label “${lv}” doesn’t exist, skipped.`);
    }

    // Members
    const members = [];
    for (const mv of splitMulti(get('members'), o.separator)) {
      const found = findMember(mv);
      if (found) members.push(found);
      else add(rowNo, 'warn', colOf.members, `“${mv}” isn’t a member of this board, skipped.`);
    }

    // Dates
    const dateField = (fid, label) => {
      const p = parseDate(get(fid), o.dateFormat, o.defaultTime);
      if (p.error) { add(rowNo, 'warn', colOf[fid], `${label} “${get(fid)}” isn’t a date I can read, skipped.`); return null; }
      return p.date || null;
    };
    const due = dateField('due', 'Due date');
    const start = dateField('start', 'Start date');
    if (due && start && start > due) add(rowNo, 'warn', colOf.start, 'Start date is after the due date.');

    // URL
    let url = get('url');
    if (url && !/^https?:\/\//i.test(url)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url;
      else { add(rowNo, 'warn', colOf.url, `“${url}” isn’t a web address, skipped.`); url = ''; }
    }

    // Coordinates
    let coords = '';
    const cv = get('coords');
    if (cv) {
      const mt = cv.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
      if (mt && Math.abs(+mt[1]) <= 90 && Math.abs(+mt[2]) <= 180) coords = `${mt[1]},${mt[2]}`;
      else add(rowNo, 'warn', colOf.coords, `“${cv}” isn’t “latitude, longitude”, skipped.`);
    }

    // Custom fields
    const custom = {};
    for (const cf of state.board.customFields) {
      const h = colOf['cf:' + cf.id];
      if (!h) continue;
      const v = String(r[h] ?? '').trim();
      if (!v) continue;
      if (cf.type === 'text') custom[cf.id] = { value: { text: v } };
      else if (cf.type === 'number') {
        const n = Number(v.replace(/\s/g, '').replace(',', '.'));
        if (isNaN(n)) add(rowNo, 'warn', h, `“${v}” isn’t a number, skipped.`);
        else custom[cf.id] = { value: { number: String(n) } };
      } else if (cf.type === 'date') {
        const p = parseDate(v, o.dateFormat, o.defaultTime);
        if (p.date) custom[cf.id] = { value: { date: p.date.toISOString() } };
        else add(rowNo, 'warn', h, `“${v}” isn’t a date I can read, skipped.`);
      } else if (cf.type === 'checkbox') {
        const nv = norm(v);
        if (TRUE_WORDS.includes(nv)) custom[cf.id] = { value: { checked: 'true' } };
        else if (!FALSE_WORDS.includes(nv)) add(rowNo, 'warn', h, `“${v}” isn’t yes/no, left unchecked.`);
      } else if (cf.type === 'list') {
        const opt = (cf.options || []).find((op) => norm(op.value.text) === norm(v));
        if (opt) custom[cf.id] = { idValue: opt.id };
        else add(rowNo, 'warn', h, `“${v}” isn’t an option of “${cf.name}”, skipped.`);
      }
    }

    // Checklist item
    let checkItem = null;
    const itemName = get('cl_item');
    if (itemName) {
      const p = parseDate(get('cl_due'), o.dateFormat, o.defaultTime);
      if (p.error) add(rowNo, 'warn', colOf.cl_due, `Item due date “${get('cl_due')}” isn’t a date I can read, skipped.`);
      let member = null;
      const mv = get('cl_member');
      if (mv) {
        member = findMember(mv);
        if (!member) add(rowNo, 'warn', colOf.cl_member, `“${mv}” isn’t a member of this board, item left unassigned.`);
      }
      checkItem = { checklist: get('cl_name') || 'Checklist', name: itemName, due: p.date || null, idMember: member?.id || null };
    } else if (get('cl_name') || get('cl_due') || get('cl_member')) {
      add(rowNo, 'warn', colOf.cl_item, 'Checklist values without an item name, ignored.');
    }

    // Build or merge the card
    const key = norm(name) + '\u0000' + (list?.id || norm(list?.newName));
    let card = o.group ? byKey.get(key) : null;
    if (!name && o.group) card = cards[cards.length - 1]; // continuation row for a checklist
    if (!card) {
      card = { name, list, desc: '', due: null, start: null, location: '', url: '', coords: '',
               labels: [], members: [], custom: {}, checklists: new Map(), rows: [] };
      cards.push(card);
      if (o.group) byKey.set(key, card);
    }
    card.rows.push(rowNo);
    const fill = (k, v) => { if (v && !card[k]) card[k] = v; };
    fill('desc', get('desc')); fill('due', due); fill('start', start);
    fill('location', get('location')); fill('url', url); fill('coords', coords);
    for (const l of labels) if (!card.labels.some((x) => x.name === l.name)) card.labels.push(l);
    for (const mb of members) if (!card.members.some((x) => x.id === mb.id)) card.members.push(mb);
    for (const [k, v] of Object.entries(custom)) if (!card.custom[k]) card.custom[k] = v;
    if (checkItem) {
      if (!card.checklists.has(checkItem.checklist)) card.checklists.set(checkItem.checklist, []);
      card.checklists.get(checkItem.checklist).push(checkItem);
    }
  });

  state.plan = { cards, issues, newLists, newLabels, options: o };
  renderCheck();
}

function renderCheck() {
  const { cards, issues, newLists, newLabels } = state.plan;
  const errs = issues.filter((i) => i.level === 'err');
  const items = cards.reduce((n, c) => n + [...c.checklists.values()].reduce((a, l) => a + l.length, 0), 0);

  // Per-column badges
  state.file.headers.forEach((h, i) => {
    const b = $('badge-' + i);
    if (!state.mapping[h]) { b.hidden = true; return; }
    const n = issues.filter((x) => x.col === h).length;
    b.hidden = false;
    b.className = 'badge ' + (n ? 'warn' : 'ok');
    b.textContent = n ? `${n} to check` : 'Data checked';
  });

  const parts = [`<b>${cards.length}</b>&nbsp;card${cards.length === 1 ? '' : 's'}`];
  if (items) parts.push(`<b>${items}</b>&nbsp;checklist item${items === 1 ? '' : 's'}`);
  if (newLists.size) parts.push(`<b>${newLists.size}</b>&nbsp;new list${newLists.size === 1 ? '' : 's'}: ${[...newLists.values()].map(esc).join(', ')}`);
  if (newLabels.size) parts.push(`<b>${newLabels.size}</b>&nbsp;new label${newLabels.size === 1 ? '' : 's'}`);

  const issueList = issues.length ? `
    <ul class="issues">${issues.map((x) => `
      <li class="${x.level}"><span class="row-ref">${x.row ? 'Row ' + x.row : 'Mapping'}</span><span>${esc(x.text)}</span></li>`).join('')}
    </ul>` : '';

  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const preview = cards.slice(0, 6).map((c) => {
    const n = [...c.checklists.values()].reduce((a, l) => a + l.length, 0);
    const meta = [];
    if (c.start) meta.push('Starts ' + fmt(c.start));
    if (c.due) meta.push('Due ' + fmt(c.due));
    if (c.members.length) meta.push(c.members.map((mb) => '@' + mb.username).join(' '));
    if (n) meta.push(`☑ ${n}`);
    if (c.desc) meta.push('≡ description');
    if (c.url) meta.push('🔗 link');
    if (c.location || c.coords) meta.push('📍 location');
    if (Object.keys(c.custom).length) meta.push(`${Object.keys(c.custom).length} custom field${Object.keys(c.custom).length > 1 ? 's' : ''}`);
    return `<div class="pcard">
      <div class="plist">${esc(c.list?.name || '—')}</div>
      ${c.labels.length ? `<div class="plabels">${c.labels.map((l) => `<span class="plabel">${esc(l.name)}</span>`).join('')}</div>` : ''}
      <div class="pname">${esc(c.name)}</div>
      ${meta.length ? `<div class="pmeta">${meta.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  $('check').innerHTML = `
    <div class="summary-line">${parts.map((p) => `<span>${p}</span>`).join('')}</div>
    ${issueList}
    ${cards.length ? `<div class="preview" aria-label="Preview of the first cards">${preview}</div>` : ''}`;

  const btn = $('btn-import');
  btn.disabled = !!errs.length || !cards.length;
  btn.textContent = cards.length ? `Import ${cards.length} card${cards.length === 1 ? '' : 's'}` : 'Import';
  const warns = issues.length - errs.length;
  $('action-hint').textContent = errs.length ? errs[0].text
    : warns ? `${warns} value${warns === 1 ? '' : 's'} will be skipped. Fix them in the CSV or import anyway.` : 'Everything checks out.';
  t.sizeTo('#app').catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

$('btn-import').addEventListener('click', runImport);
$('btn-again').addEventListener('click', () => { $('file').value = ''; loadBoard(); });
$('btn-close').addEventListener('click', () => t.closeModal());

function log(text, level) {
  const li = document.createElement('li');
  li.textContent = text;
  if (level) li.className = level;
  $('run-log').appendChild(li);
  if (li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
}

async function runImport() {
  const { cards, newLists, newLabels, options: o } = state.plan;
  show('run');
  $('run-log').innerHTML = '';
  $('run-actions').hidden = true;
  $('run-title').textContent = 'Importing…';

  const total = newLists.size + newLabels.size + cards.reduce((n, c) =>
    n + 1 + Object.keys(c.custom).length + [...c.checklists.values()].reduce((a, l) => a + 1 + l.length, 0), 0);
  let done = 0;
  const tick = () => { done++; $('progress-bar').style.width = Math.round((done / total) * 100) + '%'; };
  const listIds = new Map();
  const labelIds = new Map();
  let created = 0, failed = 0, warned = 0;

  try {
    for (const [k, name] of newLists) {
      const l = await trello('POST', '/lists', { name, idBoard: state.board.id, pos: 'bottom' });
      listIds.set(k, l.id); log(`Created list “${name}”`); tick();
    }
    let ci = 0;
    for (const [k, name] of newLabels) {
      const l = await trello('POST', '/labels', { name, color: LABEL_COLORS[ci++ % LABEL_COLORS.length], idBoard: state.board.id });
      labelIds.set(k, l.id); log(`Created label “${name}”`); tick();
    }
  } catch (e) {
    log('Couldn’t create lists or labels: ' + e.message, 'err');
    $('run-title').textContent = 'Import stopped';
    $('run-actions').hidden = false;
    return;
  }

  for (const c of cards) {
    $('run-status').textContent = `Card ${created + failed + 1} of ${cards.length}: ${c.name}`;
    const idList = c.list?.id || listIds.get(norm(c.list?.newName));
    const body = {
      idList,
      name: c.name,
      pos: o.position,
      desc: c.desc || undefined,
      due: c.due ? c.due.toISOString() : undefined,
      start: c.start ? c.start.toISOString() : undefined,
      idLabels: c.labels.map((l) => l.id || labelIds.get(norm(l.newName))).filter(Boolean),
      idMembers: c.members.map((mb) => mb.id),
      urlSource: c.url || undefined,
      address: c.location || undefined,
      locationName: c.location || undefined,
      coordinates: c.coords || undefined
    };
    let card;
    try {
      card = await trello('POST', '/cards', body);
      created++; tick();
    } catch (e) {
      failed++; log(`Row ${c.rows[0]}: “${c.name}” wasn’t created (${shortErr(e)})`, 'err');
      done += Object.keys(c.custom).length + [...c.checklists.values()].reduce((a, l) => a + 1 + l.length, 0) + 1;
      continue;
    }

    for (const [cfId, payload] of Object.entries(c.custom)) {
      try { await trello('PUT', `/cards/${card.id}/customField/${cfId}/item`, payload); }
      catch (e) { warned++; log(`“${c.name}”: custom field “${fieldById('cf:' + cfId)?.label}” not set (${shortErr(e)})`, 'warn'); }
      tick();
    }

    for (const [clName, items] of c.checklists) {
      let cl;
      try { cl = await trello('POST', '/checklists', { idCard: card.id, name: clName }); tick(); }
      catch (e) { warned++; log(`“${c.name}”: checklist “${clName}” not created (${shortErr(e)})`, 'warn'); done += 1 + items.length; continue; }
      for (const it of items) {
        const itemBody = { name: it.name, due: it.due ? it.due.toISOString() : undefined, idMember: it.idMember || undefined };
        try { await trello('POST', `/checklists/${cl.id}/checkItems`, itemBody); }
        catch (e) {
          // Item due dates and assignees need a paid Trello plan; retry with the name only.
          if ((itemBody.due || itemBody.idMember) && e.status && e.status < 500) {
            try {
              await trello('POST', `/checklists/${cl.id}/checkItems`, { name: it.name });
              warned++; log(`“${c.name}”: item “${it.name}” added without its due date or member (your Trello plan may not support them)`, 'warn');
            } catch (e2) { warned++; log(`“${c.name}”: item “${it.name}” not added (${shortErr(e2)})`, 'warn'); }
          } else { warned++; log(`“${c.name}”: item “${it.name}” not added (${shortErr(e)})`, 'warn'); }
        }
        tick();
      }
    }
  }

  $('progress-bar').style.width = '100%';
  $('run-title').textContent = failed ? 'Import finished with errors' : 'Import complete';
  $('run-status').textContent = `${created} card${created === 1 ? '' : 's'} created` +
    (failed ? `, ${failed} failed` : '') + (warned ? `, ${warned} detail${warned === 1 ? '' : 's'} skipped` : '') + '.';
  if (!failed && !warned) log('All cards were created.');
  $('run-actions').hidden = false;

  // Remember this mapping for the next file with the same columns.
  try {
    const saved = (await t.get('board', 'private', STORAGE_KEY)) || {};
    saved[signature(state.file.headers)] = { mapping: state.mapping, options: o, at: Date.now() };
    const keep = Object.entries(saved).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 5);
    await t.set('board', 'private', STORAGE_KEY, Object.fromEntries(keep));
  } catch (e) { /* storage is a convenience; ignore failures */ }
}

function shortErr(e) {
  const m = String(e.message || e);
  if (e.status === 401) return 'not authorized';
  if (e.status === 403) return 'no permission on this board';
  return m.length > 120 ? m.slice(0, 120) + '…' : m;
}

boot();
