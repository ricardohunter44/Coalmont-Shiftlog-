import * as DB from './db.js';

const APP_VERSION = '1.1.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o ?? {}));
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 20);

const LIST_DEFS = [
  { key: 'statuses', label: 'Job status', hint: 'Statuses with Complete, Closed, Invoiced or Cancelled in the name count as closed jobs.' },
  { key: 'jobTypes', label: 'Job types', hint: 'What kind of work the job is.' },
  { key: 'customers', label: 'Customers', hint: 'Companies you do work for.' },
  { key: 'sites', label: 'Sites & plants', hint: 'Where the job is.' },
  { key: 'platforms', label: 'Controllers & platforms', hint: 'PLC, HMI, drive or network platform on the job.' },
  { key: 'equipment', label: 'Equipment & areas', hint: 'Machine, panel or area a log entry is about. Makes repeat problems easy to find.' },
  { key: 'noteTags', label: 'Log entry tags', hint: 'Labels for each note you write on a job.' },
  { key: 'fileCats', label: 'File categories', hint: 'How documents are grouped on a job’s Files tab.' },
];
const DEFAULT_LISTS = {
  statuses: ['Scheduled', 'On site', 'Waiting on parts', 'Waiting on customer', 'Remote support', 'Complete', 'Invoiced'],
  jobTypes: ['PLC programming', 'HMI programming', 'Commissioning', 'Startup', 'Troubleshooting', 'Panel build / upgrade', 'Drive setup', 'Network / comms', 'Service call'],
  customers: [], sites: [],
  platforms: ['Allen-Bradley ControlLogix', 'Allen-Bradley CompactLogix', 'Allen-Bradley Micro800', 'Siemens S7-1200/1500', 'FactoryTalk View', 'PanelView Plus', 'PowerFlex drives'],
  equipment: [],
  noteTags: ['Work done', 'Program change', 'Issue found', 'Testing', 'Parts used', 'Customer request', 'Safety / LOTO', 'Follow-up needed'],
  fileCats: ['Program backup', 'Drawings', 'IO list', 'Network / IP list', 'Manual / datasheet', 'Report', 'Quote / PO', 'Other'],
};

const S = {
  jobs: [], entries: [], files: [], lists: {}, settings: { photoMax: 3000 }, lastBackup: 0,
  route: 'jobs', jobId: null, tab: 'log', filter: 'active', q: '',
  editing: null, editingFile: null, pending: [], pendingFor: null, viewer: null, busy: false,
  focus: null, restore: null, ready: false,
  ai: { key: '', model: 'claude-sonnet-5-5' }, sumView: 'organized', tidyUndo: null, aiBusy: false,
};
const AI_MODELS = [['claude-sonnet-5-5', 'Claude Sonnet 5.5 — best writing'], ['claude-haiku-5-5', 'Claude Haiku 5.5 — faster, cheaper']];

/* ---------------- helpers ---------------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3400); }
const pad = n => String(n).padStart(2, '0');
const hm = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const todayISO = () => toLocalInput(Date.now()).slice(0, 10);
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`; };
const shortDate = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
function dayLabel(ms) {
  const d = new Date(ms), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
  const base = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  if (d.toDateString() === t.toDateString()) return 'Today · ' + base;
  if (d.toDateString() === y.toDateString()) return 'Yesterday · ' + base;
  return base;
}
function ago(ms) {
  if (!ms) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return shortDate(ms);
}
const fmtSize = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const extOf = n => { const p = (n || '').split('.'); return p.length > 1 ? p.pop().slice(0, 4).toUpperCase() : 'FILE'; };
const isImg = f => /^image\/(jpeg|png|gif|webp|heic|heif|bmp)$/.test(f.type || '') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(f.name || '');
const isVid = f => /^video\//.test(f.type || '') || /\.(mov|mp4|m4v|webm)$/i.test(f.name || '');
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isText = f => /^text\//.test(f.type || '') || /\.(txt|log|csv|l5x|l5k|xml|json|md|ini|cfg|st|scl|awl|sql|htm|html)$/i.test(f.name || '');
const isMedia = f => isImg(f) || isVid(f);
const viewable = f => isMedia(f) || isPdf(f) || isText(f);
function stClass(s) { s = (s || '').toLowerCase(); if (/complete|closed|done|invoic/.test(s)) return 'done'; if (/cancel/.test(s)) return ''; if (/wait|hold|part/.test(s)) return 'wait'; if (/site|progress|active|commission|start|working|remote/.test(s)) return 'active'; return ''; }
const isClosed = s => /complete|closed|done|invoic|cancel/i.test(s || '');
const pill = s => (s ? `<span class="pill ${stClass(s)}">${esc(s)}</span>` : '');
const list = k => (Array.isArray(S.lists[k]) ? S.lists[k] : []);
const jobById = id => S.jobs.find(j => j.id === id);
const jobEntries = id => S.entries.filter(e => e.jobId === id);
const jobFiles = id => S.files.filter(f => f.jobId === id);
const entryFiles = id => S.files.filter(f => f.entryId === id);
const jobLabel = j => j ? [j.number, j.title].filter(Boolean).join(' · ') || 'Untitled job' : 'Deleted job';
const touch = () => window.matchMedia('(pointer:coarse)').matches;

function armed(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; const t = btn.textContent; btn.textContent = 'Tap again to delete'; btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = t; btn.classList.remove('armed'); } }, 3000);
  return false;
}

/* ---------- object URLs for stored files ---------- */
const urls = new Map();
async function urlFor(id) {
  if (urls.has(id)) return urls.get(id);
  const r = await DB.get('blobs', id);
  if (!r) return null;
  const u = URL.createObjectURL(r.blob); urls.set(id, u); return u;
}
function dropUrl(id) { for (const k of [id, id + '_t']) if (urls.has(k)) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); } }
async function hydrate(root = document) {
  for (const img of $$('img[data-blob]', root)) {
    const id = img.dataset.blob; img.removeAttribute('data-blob');
    const u = await urlFor(id);
    if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement('span'), { className: 'ext', textContent: 'IMG' }));
  }
}

/* ---------- dropdowns ---------- */
function optionsHtml(key, value, emptyLabel) {
  const items = list(key);
  let h = `<option value="">${esc(emptyLabel || '—')}</option>`;
  if (value && !items.includes(value)) h += `<option value="${esc(value)}">${esc(value)}</option>`;
  for (const v of items) h += `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(v)}</option>`;
  return h + `<option value="__add">+ Add new…</option>`;
}
function selectHtml(id, key, value, emptyLabel) {
  const lbl = (LIST_DEFS.find(d => d.key === key) || {}).label || 'option';
  return `<div><select id="${id}" data-list="${key}" data-prev="${esc(value || '')}" data-empty="${esc(emptyLabel || '—')}" aria-label="${esc(lbl)}">${optionsHtml(key, value, emptyLabel)}</select>
  <div class="addrow" hidden><input type="text" id="${id}-new" placeholder="New ${esc(lbl.toLowerCase())}" enterkeyhint="done"><button class="btn small primary" data-act="addOpt" data-for="${id}">Add</button><button class="btn small ghost" data-act="cancelOpt" data-for="${id}">Cancel</button></div></div>`;
}
function refillSelects() {
  for (const sel of $$('select[data-list]')) {
    const v = sel.value === '__add' ? sel.dataset.prev : sel.value;
    sel.innerHTML = optionsHtml(sel.dataset.list, v, sel.dataset.empty);
    sel.value = v || '';
  }
}
const selVal = id => { const el = $('#' + id); if (!el) return ''; return el.value === '__add' ? el.dataset.prev || '' : el.value; };

/* ---------------- persistence ---------------- */
async function saveConfig(key, value) { await DB.put('config', { key, value: clone(value) }); }
async function saveLists(next) { S.lists = next; try { await saveConfig('lists', next); } catch (e) { toast('Could not save dropdowns: ' + e.message); } }
async function saveJob(job) { await DB.put('jobs', job); upsert(S.jobs, job); }
function upsert(arr, obj) { const i = arr.findIndex(x => x.id === obj.id); if (i < 0) arr.push(obj); else arr[i] = obj; }
function jobTouched(job, ts, preview) {
  const j = { ...job, updatedAt: Date.now() };
  if (ts >= (j.lastEntryAt || 0)) { j.lastEntryAt = ts; if (preview != null) j.lastNote = String(preview).slice(0, 140); }
  return j;
}

let persistAsked = false;
async function askPersist() {
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return; persistAsked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}

/* ---------- file intake: any file type ---------- */
async function decodeImage(file) {
  try { return await createImageBitmap(file); }
  catch {
    return await new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); };
      im.src = u;
    });
  }
}
async function scaled(src, max, q) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
async function ingest(fileList, ctx, onStep) {
  const metas = [], ops = [];
  const files = [...fileList];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onStep && onStep(i, files.length);
    let blob = f, name = f.name || `file-${Date.now()}`, type = f.type || '';
    let thumb = null;
    if (isImg(f) && !/gif/i.test(type)) {
      try {
        const src = await decodeImage(f);
        thumb = await scaled(src, 360, 0.78);
        const max = S.settings.photoMax;
        const big = Math.max(src.width || src.naturalWidth, src.height || src.naturalHeight);
        if (max && (big > max || /heic|heif/i.test(type + name))) {
          const b = await scaled(src, max, 0.88);
          if (b) { blob = b; type = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; }
        }
        if (src.close) src.close();
      } catch { /* keep original, no thumbnail */ }
    }
    const id = uid();
    const meta = { id, jobId: ctx.jobId, entryId: ctx.entryId || null, name, type: type || 'application/octet-stream', size: blob.size, category: ctx.category || '', note: ctx.note || '', at: ctx.at || Date.now(), thumb: !!thumb };
    metas.push(meta);
    ops.push(['put', 'files', meta], ['put', 'blobs', { id, blob }]);
    if (thumb) ops.push(['put', 'blobs', { id: id + '_t', blob: thumb }]);
  }
  return { metas, ops };
}
function fileDeleteOps(metas) { const ops = []; for (const m of metas) ops.push(['del', 'files', m.id], ['del', 'blobs', m.id], ['del', 'blobs', m.id + '_t']); return ops; }

/* ---------- saving files out ---------- */
let pendingSave = null;
async function offerSave(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (touch() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) {
      if (e.name === 'AbortError') return false;
      if (e.name === 'NotAllowedError') { pendingSave = { blob, name }; openSheet(`<h2>Ready to save</h2><p class="muted" style="margin:0">${esc(name)} · ${fmtSize(blob.size)}</p><div class="row"><button class="btn primary" data-act="finishSave">Save / Share file</button><button class="btn ghost" data-act="closeSheet">Cancel</button></div>`); return false; }
    }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return true;
}
async function saveStored(id) {
  const m = S.files.find(f => f.id === id); const r = await DB.get('blobs', id);
  if (!m || !r) { toast('That file is missing from this device.'); return; }
  await offerSave(r.blob, m.name);
}

/* ---------------- routing ---------------- */
function go(h) { if (location.hash !== '#' + h) location.hash = h; else route(); }
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const prevJob = S.jobId;
  if (h.startsWith('job-')) { S.route = 'job'; S.jobId = h.slice(4); if (prevJob !== S.jobId && !S.focus) S.tab = 'log'; }
  else if (h === 'new') S.route = 'new';
  else if (h === 'lists') S.route = 'lists';
  else if (h === 'backup') S.route = 'backup';
  else S.route = 'jobs';
  if (S.pendingFor !== S.jobId || S.route !== 'job') clearPending();
  S.editing = null; S.editingFile = null;
  render();
  if (!S.focus) window.scrollTo(0, 0);
}
function render() {
  if (!S.ready) return;
  for (const k of ['jobs', 'lists', 'backup']) $('#nav-' + k).classList.toggle('on', S.route === k || (k === 'jobs' && ['job', 'new'].includes(S.route)));
  if (S.route === 'lists') return renderLists();
  if (S.route === 'backup') return renderBackup();
  if (S.route === 'new') return renderInfo(null);
  if (S.route === 'job') return renderJob();
  renderJobs();
}
function drawHdr(title, back) {
  $('#hdr').innerHTML = back
    ? `<div class="crumb"><button class="back" data-act="back">‹ Jobs</button><b>${esc(title)}</b></div>`
    : `<div class="brand"><span class="lamp"></span>${esc(title)}</div>`;
}

/* ---------------- jobs + search ---------------- */
function backupBanner() {
  if (!S.jobs.length) return '';
  const days = S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / 86400000) : null;
  if (days !== null && days < 7) return '';
  return `<div class="banner"><span class="grow">${days === null ? 'Your jobs only live on this phone and haven’t been backed up yet.' : `Last backup was ${days} days ago.`}</span><a class="btn small" href="#backup">Back up</a></div>`;
}
function renderJobs() {
  drawHdr('Jobflow');
  $('#view').innerHTML = `<div class="stack">${backupBanner()}${updateBanner()}
    <div class="row"><input type="search" id="q" class="grow" placeholder="Search jobs, notes, equipment, files" value="${esc(S.q)}" enterkeyhint="search"><button class="btn primary" data-act="newJob">+ New job</button></div>
    <div id="below"></div></div>`;
  drawBelow();
}
function drawBelow() {
  const box = $('#below'); if (!box) return;
  if (S.q.trim().length >= 2) { box.innerHTML = searchHtml(S.q.trim()); hydrate(box); return; }
  box.innerHTML = `<div class="stack"><div class="seg">${['active', 'closed', 'all'].map(f => `<button data-act="filter" data-f="${f}" class="${S.filter === f ? 'on' : ''}">${f === 'active' ? 'Open' : f === 'closed' ? 'Closed' : 'All'}</button>`).join('')}</div><div id="jobList">${jobListHtml()}</div></div>`;
}
function jobListHtml() {
  if (!S.jobs.length) return `<div class="empty"><b>No jobs yet.</b><span>Tap New job to set up your first one. Each job keeps its own time-stamped log, photos, files and links, all stored on this phone so it works with no signal.</span></div>`;
  const js = S.jobs.filter(j => S.filter === 'all' ? true : S.filter === 'closed' ? isClosed(j.status) : !isClosed(j.status))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!js.length) return `<div class="empty"><b>No ${S.filter === 'closed' ? 'closed' : 'open'} jobs.</b><span>Switch to All to see everything.</span></div>`;
  return `<div class="jobs">${js.map(j => `<a class="job" href="#job-${esc(j.id)}">
    <div><div class="num">${esc(j.number || 'No job #')}</div><div class="ttl">${esc(j.title || 'Untitled job')}</div></div>
    <div class="side">${pill(j.status)}<span class="when">${esc(ago(j.lastEntryAt || j.updatedAt))}</span></div>
    <div class="meta">${esc([j.customer, j.site, j.jobType].filter(Boolean).join(' · ') || j.lastNote || 'No details yet')}</div></a>`).join('')}</div>`;
}
function snippet(text, q) {
  const t = String(text || ''), i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(t.slice(0, 160)) + (t.length > 160 ? '…' : '');
  const a = Math.max(0, i - 60), b = Math.min(t.length, i + q.length + 100);
  return (a ? '…' : '') + esc(t.slice(a, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length, b)) + (b < t.length ? '…' : '');
}
function searchHtml(q) {
  const t = q.toLowerCase(), has = s => String(s || '').toLowerCase().includes(t);
  const jobs = S.jobs.filter(j => [j.number, j.title, j.customer, j.site, j.jobType, j.platform, j.po, j.contact, j.scope, j.status].some(has));
  const ents = S.entries.filter(e => e.kind === 'note' && [e.text, e.tag, e.equipment].some(has)).sort((a, b) => b.ts - a.ts).slice(0, 60);
  const fls = S.files.filter(f => [f.name, f.category, f.note].some(has)).sort((a, b) => b.at - a.at).slice(0, 60);
  if (!jobs.length && !ents.length && !fls.length) return `<div class="empty"><b>Nothing matches “${esc(q)}”.</b><span>Search covers job details, every log note, equipment names and file names across all jobs.</span></div>`;
  const sec = (title, n, body) => n ? `<section class="sec"><div class="sec-h"><h3>${title}</h3><span class="ct">${n}</span></div>${body}</section>` : '';
  return `<div class="results">
    ${sec('Jobs', jobs.length, `<div class="jobs">${jobs.map(j => `<a class="job" href="#job-${esc(j.id)}"><div><div class="num">${esc(j.number || 'No job #')}</div><div class="ttl">${snippet(j.title || 'Untitled job', q)}</div></div><div class="side">${pill(j.status)}</div><div class="meta">${esc([j.customer, j.site].filter(Boolean).join(' · '))}</div></a>`).join('')}</div>`)}
    ${sec('Log notes', ents.length, `<div class="stack" style="gap:8px">${ents.map(e => `<button class="hit" data-act="openHit" data-job="${esc(e.jobId)}" data-entry="${esc(e.id)}"><span class="where">${esc(jobLabel(jobById(e.jobId)))} · ${esc(shortDate(e.ts))} ${hm(e.ts)}</span><span class="row" style="gap:6px">${e.tag ? `<span class="tag">${snippet(e.tag, q)}</span>` : ''}${e.equipment ? `<span class="equip">${snippet(e.equipment, q)}</span>` : ''}</span><span class="what">${snippet(e.text, q)}</span></button>`).join('')}</div>`)}
    ${sec('Files', fls.length, `<div class="stack" style="gap:8px">${fls.map(f => `<button class="hit" data-act="openHit" data-job="${esc(f.jobId)}" data-file="${esc(f.id)}"><span class="where">${esc(jobLabel(jobById(f.jobId)))} · ${esc(f.category || (f.entryId ? 'From log' : 'File'))}</span><span class="what"><b>${snippet(f.name, q)}</b>${f.note ? ' — ' + snippet(f.note, q) : ''}</span></button>`).join('')}</div>`)}
  </div>`;
}

/* ---------------- job screen ---------------- */
function renderJob() {
  const j = jobById(S.jobId);
  if (!j) { drawHdr('Job', true); $('#view').innerHTML = `<div class="empty"><b>This job was deleted.</b><span><a href="#jobs">Back to jobs</a></span></div>`; return; }
  drawHdr(j.number || 'Job', true);
  const tabs = [['log', 'Log'], ['files', 'Files'], ['info', 'Info']];
  $('#view').innerHTML = `<div class="stack">
    <div class="jhead" id="jhead"></div>
    <div class="row"><div class="seg grow">${tabs.map(([k, l]) => `<button data-act="tab" data-t="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn" data-act="openSummary">Summary</button><button class="btn" data-act="exportJob">Export</button></div>
    <div id="tabbody"></div></div>`;
  drawJobHead();
  if (S.tab === 'log') renderLogTab(); else if (S.tab === 'files') renderFilesTab(); else renderInfo(j, $('#tabbody'));
  if (S.focus) {
    const f = S.focus; S.focus = null;
    requestAnimationFrame(() => {
      const el = f.entry ? $(`.entry[data-id="${CSS.escape(f.entry)}"]`) : $(`.frow[data-id="${CSS.escape(f.file)}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }
    });
  }
}
function drawJobHead() {
  const j = jobById(S.jobId), box = $('#jhead'); if (!j || !box) return;
  box.innerHTML = `<div>${j.number ? `<div class="num">${esc(j.number)}</div>` : ''}<h2>${esc(j.title || 'Untitled job')}</h2></div>
    <div class="meta">${esc([j.customer, j.site, j.jobType, j.platform].filter(Boolean).join(' · ') || 'Add customer, site and type under Info.')}</div>
    <div class="status-sel">${selectHtml('hdr-status', 'statuses', j.status, 'No status')}</div>`;
}
function clockInfo(id) {
  const cl = jobEntries(id).filter(e => e.kind === 'arrive' || e.kind === 'leave').sort((a, b) => a.ts - b.ts);
  let total = 0, open = null;
  for (const e of cl) { if (e.kind === 'arrive') { if (open == null) open = e.ts; } else if (open != null) { total += Math.max(0, e.ts - open); open = null; } }
  return { total: total + (open != null ? Math.max(0, Date.now() - open) : 0), onSince: open };
}
const hmDur = ms => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
function drawClock() {
  const box = $('#clock'); if (!box) return;
  const c = clockInfo(S.jobId);
  box.innerHTML = `<div class="state">${c.onSince != null ? `<span class="onsite">On site since <span class="mono">${hm(c.onSince)}</span></span>` : 'Not on site'}<br><span class="muted">Total on site <span class="mono">${hmDur(c.total)}</span></span></div>
    ${c.onSince != null ? `<button class="btn" data-act="clock" data-k="leave">Left site</button>` : `<button class="btn primary" data-act="clock" data-k="arrive">Arrived on site</button>`}`;
}
function draft(id) { try { return JSON.parse(localStorage.getItem('jf-draft-' + id) || '{}'); } catch { return {}; } }
function saveDraft() {
  if (S.route !== 'job' || !$('#c-text')) return;
  const d = { text: $('#c-text').value, tag: selVal('c-tag'), equipment: selVal('c-equip'), time: $('#c-time').value };
  try { localStorage.setItem('jf-draft-' + S.jobId, JSON.stringify(d)); } catch {}
}
function clearDraft(id) { try { localStorage.removeItem('jf-draft-' + id); } catch {} }

function renderLogTab() {
  const d = draft(S.jobId);
  $('#tabbody').innerHTML = `<div class="stack">
    <div class="clockbar" id="clock"></div>
    <div class="card composer">
      <label class="f">What did you do?<textarea id="c-text" placeholder="e.g. Downloaded program from L33ER. Added jam detect to R04_Conveyors, tested with operator. Saved as Conv3_v14.ACD">${esc(d.text || '')}</textarea></label>
      <div class="opts3">
        <label class="f">Tag${selectHtml('c-tag', 'noteTags', d.tag ?? (list('noteTags')[0] || ''), 'No tag')}</label>
        <label class="f">Equipment / area${selectHtml('c-equip', 'equipment', d.equipment || '', 'None')}</label>
        <label class="f">Time<input type="datetime-local" id="c-time" value="${esc(d.time || '')}"><span class="hint">Blank = time you save.</span></label>
      </div>
      <div class="staged" id="staged"></div>
      <div class="row">
        <button class="btn" data-act="pick" data-in="c-photo">Photo / video</button><button class="btn" data-act="pick" data-in="c-file">File</button>
        ${S.ai.key ? `<button class="btn" data-act="tidy" id="c-tidy">Tidy with AI</button><button class="btn ghost" data-act="undoTidy" id="c-undo" hidden>Undo tidy</button>` : ''}
        <span class="grow progress" id="c-prog"></span>
        <button class="btn primary" data-act="saveEntry">Save entry</button>
      </div>
      <input type="file" id="c-photo" accept="image/*,video/*" multiple hidden>
      <input type="file" id="c-file" multiple hidden>
    </div>
    <div id="timeline"></div></div>`;
  drawClock(); drawStaged(); drawTimeline();
}
function drawStaged() {
  const box = $('#staged'); if (!box) return;
  box.innerHTML = S.pending.map((p, i) => `<div class="stg">${p.url ? `<img src="${p.url}" alt="">` : `<span class="ext">${esc(extOf(p.file.name))}</span>`}<span>${esc(p.file.name)}</span><button aria-label="Remove ${esc(p.file.name)}" data-act="unstage" data-i="${i}">×</button></div>`).join('');
}
function clearPending() { for (const p of S.pending) if (p.url) URL.revokeObjectURL(p.url); S.pending = []; S.pendingFor = S.jobId; }

function mediaTiles(fs) {
  return fs.map(f => `<button class="tile" data-act="view" data-id="${esc(f.id)}" aria-label="Open ${esc(f.name)}">${f.thumb ? `<img alt="" data-blob="${esc(f.id)}_t">` : `<span class="ext">${isVid(f) ? '▶ ' : ''}${esc(extOf(f.name))}</span>`}${isVid(f) && f.thumb ? '<small>VIDEO</small>' : ''}</button>`).join('');
}
function fileRow(f, meta) {
  if (S.editingFile === f.id) {
    return `<li class="frow" data-id="${esc(f.id)}"><form data-act-submit="saveFileEdit" data-id="${esc(f.id)}">
      <label class="f">File name<input type="text" id="fe-name" value="${esc(f.name)}"></label>
      <label class="f">Category${selectHtml('fe-cat', 'fileCats', f.category, 'No category')}</label>
      <label class="f">Description<input type="text" id="fe-note" value="${esc(f.note || '')}" placeholder="e.g. Program before changes, rev 13"></label>
      <div class="row"><button class="btn small primary" type="submit">Save</button><button class="btn small ghost" type="button" data-act="cancelFileEdit">Cancel</button></div></form></li>`;
  }
  return `<li class="frow" data-id="${esc(f.id)}">${f.thumb ? `<img alt="" data-blob="${esc(f.id)}_t">` : `<span class="ext">${esc(extOf(f.name))}</span>`}
    <div class="fn"><b>${esc(f.name)}</b><small>${esc([fmtSize(f.size || 0), meta].filter(Boolean).join(' · '))}</small>${f.note ? `<small>${esc(f.note)}</small>` : ''}</div>
    <div class="fa">${viewable(f) ? `<button class="btn small" data-act="view" data-id="${esc(f.id)}">View</button>` : ''}<button class="btn small" data-act="saveFile" data-id="${esc(f.id)}">Save / Share</button><button class="btn small ghost" data-act="editFile" data-id="${esc(f.id)}">Edit</button><button class="btn small ghost danger" data-act="delFile" data-id="${esc(f.id)}">Delete</button></div></li>`;
}
function entryHtml(e) {
  const acts = label => `<span class="e-acts"><button data-act="editEntry" data-id="${esc(e.id)}">${label}</button><button data-act="delEntry" data-id="${esc(e.id)}">Delete</button></span>`;
  if (e.kind === 'arrive' || e.kind === 'leave') {
    if (S.editing === e.id) return `<article class="entry k-${e.kind}" data-id="${esc(e.id)}"><div class="e-time mono">${hm(e.ts)}</div><div class="e-body"><div class="row"><input type="datetime-local" id="ed-time" value="${toLocalInput(e.ts)}" style="max-width:240px"><button class="btn small primary" data-act="saveEdit" data-id="${esc(e.id)}">Save</button><button class="btn small ghost" data-act="cancelEdit">Cancel</button></div></div></article>`;
    return `<article class="entry k-${e.kind}" data-id="${esc(e.id)}"><div class="e-time mono">${hm(e.ts)}</div><div class="e-body"><div class="e-head"><span class="clocktxt">${e.kind === 'arrive' ? 'Arrived on site' : 'Left site'}</span>${acts('Edit time')}</div></div></article>`;
  }
  if (S.editing === e.id) {
    return `<article class="entry k-note" data-id="${esc(e.id)}"><div class="e-time mono">${hm(e.ts)}</div><div class="e-body">
      <textarea id="ed-text">${esc(e.text || '')}</textarea>
      <div class="opts3">${selectHtml('ed-tag', 'noteTags', e.tag || '', 'No tag')}${selectHtml('ed-equip', 'equipment', e.equipment || '', 'No equipment')}<input type="datetime-local" id="ed-time" value="${toLocalInput(e.ts)}"></div>
      <div class="row"><button class="btn small" data-act="pick" data-in="ed-add">Add photo / file</button><span class="grow progress" id="ed-prog"></span><button class="btn small primary" data-act="saveEdit" data-id="${esc(e.id)}">Save</button><button class="btn small ghost" data-act="cancelEdit">Cancel</button></div>
      <input type="file" id="ed-add" multiple hidden data-entry="${esc(e.id)}"></div></article>`;
  }
  const fs = entryFiles(e.id), media = fs.filter(isMedia), docs = fs.filter(f => !isMedia(f));
  return `<article class="entry k-note" data-id="${esc(e.id)}"><div class="e-time mono">${hm(e.ts)}</div><div class="e-body">
    <div class="e-head">${e.tag ? `<span class="tag">${esc(e.tag)}</span>` : ''}${e.equipment ? `<span class="equip">${esc(e.equipment)}</span>` : ''}${acts('Edit')}</div>
    ${e.text ? `<p class="e-text">${esc(e.text)}</p>` : ''}
    ${media.length ? `<div class="thumbs">${mediaTiles(media)}</div>` : ''}
    ${docs.length ? `<ul class="flist">${docs.map(f => fileRow(f, f.category)).join('')}</ul>` : ''}
  </div></article>`;
}
function drawTimeline() {
  const box = $('#timeline'); if (!box) return;
  const es = jobEntries(S.jobId).sort((a, b) => b.ts - a.ts);
  if (!es.length) { box.innerHTML = `<div class="empty"><b>Nothing logged yet.</b><span>Tap Arrived on site when you get there, then add notes, photos and files as you work. Every entry is time-stamped, and Report turns the log into a service report.</span></div>`; return; }
  const days = [];
  for (const e of es) { const k = new Date(e.ts).toDateString(); let d = days[days.length - 1]; if (!d || d.k !== k) days.push(d = { k, ts: e.ts, items: [] }); d.items.push(e); }
  box.innerHTML = days.map(d => `<section class="day"><h3>${esc(dayLabel(d.ts))}</h3><div class="entries">${d.items.map(entryHtml).join('')}</div></section>`).join('');
  hydrate(box);
}

/* files tab */
function renderFilesTab() {
  const lastCat = (() => { try { return localStorage.getItem('jf-lastcat') || ''; } catch { return ''; } })();
  $('#tabbody').innerHTML = `<div class="stack">
    <div class="card stack" style="gap:10px">
      <b>Add files to this job</b>
      <span class="hint" style="font-size:13px">Any file type: .ACD and .L5X programs, drawings, Word, Excel, PDFs, ZIPs, videos. Stored on this phone.</span>
      <div class="fgrid">
        <label class="f">Category${selectHtml('j-cat', 'fileCats', list('fileCats').includes(lastCat) ? lastCat : '', 'No category')}</label>
        <label class="f">Description (optional)<input type="text" id="j-note" placeholder="e.g. Program as found, before changes"></label>
      </div>
      <div class="row"><button class="btn primary" data-act="pick" data-in="j-file">Choose files</button><span class="progress grow" id="j-prog"></span></div>
      <input type="file" id="j-file" multiple hidden>
      <details><summary class="muted" style="cursor:pointer;font-size:14px">Add a link instead</summary>
        <div class="row" style="margin-top:8px"><input type="text" id="l-label" placeholder="Link name" style="flex:1 1 140px"><input type="url" id="l-url" placeholder="https://…" style="flex:2 1 200px"><button class="btn" data-act="addLink">Add link</button></div></details>
    </div>
    <div id="filesbody"></div></div>`;
  drawFiles();
}
function drawFiles() {
  const box = $('#filesbody'); if (!box) return;
  const j = jobById(S.jobId) || {}, fs = jobFiles(S.jobId).sort((a, b) => b.at - a.at);
  const media = fs.filter(isMedia), docs = fs.filter(f => !isMedia(f)), links = [...(j.links || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  if (!fs.length && !links.length) { box.innerHTML = `<div class="empty"><b>No files on this job yet.</b><span>Photos and files you attach to log entries show up here too, so everything for the job is in one place.</span></div>`; return; }
  const cats = [...list('fileCats')];
  const groups = new Map();
  for (const f of docs) { const k = f.category || (f.entryId ? 'From log entries' : 'Uncategorized'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
  const order = [...groups.keys()].sort((a, b) => { const ia = cats.indexOf(a), ib = cats.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); });
  const meta = f => [f.entryId ? 'Log ' + shortDate(f.at) + ' ' + hm(f.at) : 'Added ' + shortDate(f.at)].join(' · ');
  box.innerHTML = `<div class="stack" style="gap:22px">
    ${media.length ? `<section class="sec"><div class="sec-h"><h3>Photos & video</h3><span class="ct">${media.length}</span></div><div class="gallery">${mediaTiles(media)}</div></section>` : ''}
    ${order.map(k => `<section class="sec"><div class="sec-h"><h3>${esc(k)}</h3><span class="ct">${groups.get(k).length}</span></div><ul class="flist">${groups.get(k).map(f => fileRow(f, meta(f))).join('')}</ul></section>`).join('')}
    ${links.length ? `<section class="sec"><div class="sec-h"><h3>Links</h3><span class="ct">${links.length}</span></div>${links.map(l => `<div class="linkrow"><div style="min-width:0"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a><small>${esc(l.url)}</small></div><button class="btn small ghost danger" data-act="rmLink" data-url="${esc(l.url)}">Remove</button></div>`).join('')}</section>` : ''}
  </div>`;
  hydrate(box);
}
function redrawJobParts() { drawJobHead(); if (S.tab === 'log') { drawClock(); drawTimeline(); } else if (S.tab === 'files') drawFiles(); }

/* info / new */
function renderInfo(j, into) {
  const isNew = !j; j = j || { status: list('statuses')[0] || '', start: todayISO() };
  if (isNew) drawHdr('New job', true);
  (into || $('#view')).innerHTML = `<form class="card stack" data-act-submit="saveInfo">
    ${isNew ? `<h2>New job</h2>` : ''}
    <div class="fgrid">
      <label class="f">Job #<input type="text" id="f-number" value="${esc(j.number || '')}" placeholder="e.g. 26-0412"></label>
      <label class="f">Start date<input type="date" id="f-start" value="${esc(j.start || '')}"></label>
      <label class="f full">Job title<input type="text" id="f-title" value="${esc(j.title || '')}" placeholder="e.g. Line 2 palletizer PLC upgrade"></label>
      <label class="f">Customer${selectHtml('f-customer', 'customers', j.customer, 'Choose customer')}</label>
      <label class="f">Site / plant${selectHtml('f-site', 'sites', j.site, 'Choose site')}</label>
      <label class="f">Job type${selectHtml('f-jobType', 'jobTypes', j.jobType, 'Choose type')}</label>
      <label class="f">Status${selectHtml('f-status', 'statuses', j.status, 'No status')}</label>
      <label class="f">Controller / platform${selectHtml('f-platform', 'platforms', j.platform, 'Choose platform')}</label>
      <label class="f">PO / work order #<input type="text" id="f-po" value="${esc(j.po || '')}"></label>
      <label class="f">Site contact<input type="text" id="f-contact" value="${esc(j.contact || '')}" placeholder="Name"></label>
      <label class="f">Contact phone<input type="tel" id="f-phone" value="${esc(j.phone || '')}"></label>
      <label class="f full">Scope & notes<textarea id="f-scope" placeholder="What the customer asked for, IP addresses, panel numbers, gate codes">${esc(j.scope || '')}</textarea></label>
    </div>
    <div class="row"><button class="btn primary" type="submit">${isNew ? 'Create job' : 'Save changes'}</button>
      ${isNew ? `<button class="btn ghost" type="button" data-act="back">Cancel</button>` : `<span class="grow"></span><button class="btn danger" type="button" data-act="delJob">Delete job</button>`}</div>
  </form>`;
}
function readInfo() {
  const g = id => (($('#' + id) || {}).value || '').trim();
  return { number: g('f-number'), title: g('f-title'), start: g('f-start'), customer: selVal('f-customer'), site: selVal('f-site'), jobType: selVal('f-jobType'), status: selVal('f-status'), platform: selVal('f-platform'), po: g('f-po'), contact: g('f-contact'), phone: g('f-phone'), scope: ($('#f-scope') || {}).value || '' };
}

/* ---------------- dropdowns screen ---------------- */
function renderLists() {
  drawHdr('Dropdowns');
  $('#view').innerHTML = `<div class="stack">
    <p class="muted" style="margin:0;max-width:62ch">Every dropdown in Jobflow pulls from these lists. Add, remove or reorder options here, or pick “+ Add new…” from any dropdown while you work. Removing an option doesn’t change jobs that already use it.</p>
    <div class="lists" id="lists"></div></div>`;
  drawLists();
}
function drawLists() {
  const box = $('#lists'); if (!box) return;
  box.innerHTML = LIST_DEFS.map(d => {
    const items = list(d.key);
    return `<section class="card stack" style="gap:10px"><div><b>${esc(d.label)}</b><div class="hint" style="font-size:13px">${esc(d.hint)}</div></div>
      <div class="opts-list">${items.length ? items.map((v, i) => `<span class="opt">${esc(v)}${i ? `<button aria-label="Move ${esc(v)} up" data-act="optUp" data-k="${d.key}" data-i="${i}">↑</button>` : ''}<button class="x" aria-label="Remove ${esc(v)}" data-act="optRm" data-k="${d.key}" data-i="${i}">×</button></span>`).join('') : `<span class="hint">No options yet.</span>`}</div>
      <div class="addrow" style="margin:0"><input type="text" id="new-${d.key}" placeholder="Add option" data-k="${d.key}" enterkeyhint="done"><button class="btn small" data-act="optAdd" data-k="${d.key}">Add</button></div></section>`;
  }).join('');
}

/* ---------------- backup screen ---------------- */
let swReg = null, updateReady = false;
function updateBanner() { return updateReady ? `<div class="banner info"><span class="grow">A new version of Jobflow is ready.</span><button class="btn small" data-act="applyUpdate">Update now</button></div>` : ''; }
async function renderBackup() {
  drawHdr('Settings');
  const total = S.files.reduce((s, f) => s + (f.size || 0), 0);
  $('#view').innerHTML = `<div class="stack">${updateBanner()}
    <section class="card stack">
      <div><h2>Back up everything</h2><p class="muted" style="margin:6px 0 0;max-width:60ch">Your jobs live on this phone only. A backup is one .zip file with every job, note, photo and file in it. Save it to iCloud Drive, Google Drive, OneDrive or your laptop. If your phone is lost or replaced, restore it below.</p></div>
      <dl class="kv"><dt>Last backup</dt><dd>${S.lastBackup ? esc(new Date(S.lastBackup).toLocaleString()) : 'Never'}</dd><dt>Jobs</dt><dd>${S.jobs.length}</dd><dt>Log entries</dt><dd>${S.entries.length}</dd><dt>Files</dt><dd>${S.files.length} · ${fmtSize(total)}</dd></dl>
      <div class="row"><button class="btn primary" data-act="backupAll" ${S.jobs.length ? '' : 'disabled'}>Create backup file</button><span class="progress grow" id="b-prog"></span></div>
    </section>
    <section class="card stack">
      <div><h2>Restore from a backup</h2><p class="muted" style="margin:6px 0 0;max-width:60ch">Adds the jobs from a Jobflow backup .zip to this phone. Jobs that are already here get updated to the backup's version. Nothing else is removed.</p></div>
      <div class="row"><button class="btn" data-act="pick" data-in="r-file">Choose backup .zip</button><span class="progress grow" id="r-prog"></span></div>
      <input type="file" id="r-file" accept=".zip,application/zip" hidden>
    </section>
    <section class="card stack">
      <div><h2>AI help</h2><p class="muted" style="margin:6px 0 0;max-width:60ch">When you have signal, AI can tidy a note before you save it and write a clean summary of a whole job. It only works from what you logged. With no signal, everything else in Jobflow keeps working.</p></div>
      <label class="f">Anthropic API key<input type="password" id="ai-key" value="${esc(S.ai.key)}" placeholder="sk-ant-…" autocomplete="off" spellcheck="false"><span class="hint">Create one at console.anthropic.com → API keys, and set a monthly spend limit there. The key is stored only on this phone and is never put in backups.</span></label>
      <label class="f">Model<select id="ai-model">${AI_MODELS.map(([v, l]) => `<option value="${v}"${S.ai.model === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary" data-act="saveAi">Save</button><button class="btn" data-act="testAi">Test</button>${S.ai.key ? `<span class="grow"></span><button class="btn ghost danger" data-act="removeAi">Remove key</button>` : ''}</div>
      <span class="hint">Notes you send to AI go to Anthropic to be processed. Check that your customer allows that before using it on their jobs.</span>
    </section>
    <section class="card stack">
      <h2>Photos & storage</h2>
      <label class="f">Photo size<select id="s-photo"><option value="3000">Shrink to 3000 px (recommended, about 1 MB each)</option><option value="0">Keep full size</option></select><span class="hint">Shrunk photos stay sharp enough to read nameplates and wire tags.</span></label>
      <dl class="kv" id="storage"><dt>Storage</dt><dd>Checking…</dd></dl>
      <div class="row"><button class="btn small" data-act="persist">Protect data from cleanup</button></div>
    </section>
    <p class="hint">Jobflow ${APP_VERSION} · works offline</p></div>`;
  $('#s-photo').value = String(S.settings.photoMax || 0);
  drawStorage();
}
async function drawStorage() {
  const box = $('#storage'); if (!box) return;
  let html = '';
  try { const e = await navigator.storage.estimate(); html += `<dt>Used</dt><dd>${fmtSize(e.usage || 0)} of ${fmtSize(e.quota || 0)} available</dd>`; } catch { html += `<dt>Used</dt><dd>Unknown</dd>`; }
  try { const p = await navigator.storage.persisted(); html += `<dt>Protected</dt><dd>${p ? 'Yes' : 'No'}</dd>`; } catch {}
  if ($('#storage')) $('#storage').innerHTML = html;
}

async function buildBackup(onProg) {
  const zip = new JSZip();
  const meta = { app: 'jobflow', format: 1, version: APP_VERSION, exportedAt: Date.now(), jobs: S.jobs, entries: S.entries, files: S.files, lists: S.lists, settings: S.settings };
  zip.file('jobflow-backup.json', JSON.stringify(meta, null, 1));
  for (let i = 0; i < S.files.length; i++) {
    const f = S.files[i]; onProg && onProg(`Packing file ${i + 1} of ${S.files.length}…`);
    const b = await DB.get('blobs', f.id); if (b) zip.file('blobs/' + f.id, b.blob, { binary: true });
    if (f.thumb) { const t = await DB.get('blobs', f.id + '_t'); if (t) zip.file('blobs/' + f.id + '_t', t.blob, { binary: true }); }
  }
  onProg && onProg('Compressing…');
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
}
async function markBackedUp() { S.lastBackup = Date.now(); await saveConfig('lastBackup', S.lastBackup); if (S.route === 'backup') renderBackup(); }
async function readBackup(file) {
  const zip = await JSZip.loadAsync(file);
  const mf = zip.file('jobflow-backup.json');
  if (!mf) throw new Error('That isn’t a Jobflow backup file.');
  const meta = JSON.parse(await mf.async('string'));
  if (meta.app !== 'jobflow') throw new Error('That isn’t a Jobflow backup file.');
  return { zip, meta };
}
async function applyBackup({ zip, meta }, onProg) {
  const ops = [];
  for (const j of meta.jobs || []) ops.push(['put', 'jobs', j]);
  for (const e of meta.entries || []) ops.push(['put', 'entries', e]);
  await DB.batch(ops);
  const files = meta.files || [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; onProg && onProg(`Restoring file ${i + 1} of ${files.length}…`);
    const fo = [['put', 'files', f]];
    const b = zip.file('blobs/' + f.id);
    if (b) fo.push(['put', 'blobs', { id: f.id, blob: new Blob([await b.async('arraybuffer')], { type: f.type || '' }) }]);
    const t = zip.file('blobs/' + f.id + '_t');
    if (t) fo.push(['put', 'blobs', { id: f.id + '_t', blob: new Blob([await t.async('arraybuffer')], { type: 'image/jpeg' }) }]);
    await DB.batch(fo);
  }
  const merged = clone(S.lists);
  for (const k of Object.keys(meta.lists || {})) { merged[k] = [...new Set([...(merged[k] || []), ...(meta.lists[k] || [])])]; }
  await saveLists(merged);
  await loadAll();
}

/* ---------------- report & export ---------------- */
function buildReport(id) {
  const j = jobById(id) || {}, L = [], line = '-'.repeat(48);
  L.push(`${j.number ? j.number + ' — ' : ''}${j.title || 'Untitled job'}`, line);
  for (const [k, v] of [['Customer', j.customer], ['Site', j.site], ['Job type', j.jobType], ['Platform', j.platform], ['Status', j.status], ['PO / WO', j.po], ['Contact', [j.contact, j.phone].filter(Boolean).join(', ')], ['Start', j.start]]) if (v) L.push(`${(k + ':').padEnd(11)}${v}`);
  L.push(`${'On site:'.padEnd(11)}${hmDur(clockInfo(id).total)}`);
  if (j.scope) L.push('', 'SCOPE', j.scope.trim());
  L.push('', 'WORK LOG');
  const es = jobEntries(id).sort((a, b) => a.ts - b.ts); let day = '';
  if (!es.length) L.push('(nothing logged)');
  for (const e of es) {
    const d = new Date(e.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (d !== day) { L.push('', d); day = d; }
    const head = `  ${hm(e.ts)}  `, ind = ' '.repeat(head.length);
    if (e.kind !== 'note') { L.push(head + (e.kind === 'arrive' ? 'Arrived on site' : 'Left site')); continue; }
    const pre = [e.tag && `[${e.tag}]`, e.equipment && `(${e.equipment})`].filter(Boolean).join(' ');
    const body = ((pre ? pre + ' ' : '') + (e.text || '')).trim().split('\n');
    L.push(head + (body[0] || ''), ...body.slice(1).map(s => ind + s));
    const fs = entryFiles(e.id); if (fs.length) L.push(ind + 'Attached: ' + fs.map(f => f.name).join(', '));
  }
  const docs = jobFiles(id).filter(f => !f.entryId);
  if (docs.length) { L.push('', 'JOB FILES'); for (const f of docs) L.push(`  ${f.category ? '[' + f.category + '] ' : ''}${f.name}${f.note ? ' — ' + f.note : ''}`); }
  if ((j.links || []).length) { L.push('', 'LINKS'); for (const l of j.links) L.push(`  ${l.label ? l.label + ': ' : ''}${l.url}`); }
  return L.join('\n');
}
const safeName = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
async function buildJobZip(id, onProg) {
  const j = jobById(id), zip = new JSZip(), root = safeName(jobLabel(j));
  const z = zip.folder(root);
  z.file('full log.txt', buildReport(id));
  z.file('summary.txt', j.summary ? j.summary.text : buildOrganized(id));
  const used = new Set(), fs = jobFiles(id);
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i]; onProg && onProg(`Packing ${i + 1} of ${fs.length}…`);
    const b = await DB.get('blobs', f.id); if (!b) continue;
    const folder = isMedia(f) ? 'Photos & video' : safeName(f.category || (f.entryId ? 'From log' : 'Other'));
    let name = isMedia(f) ? `${stamp(f.at)} ${safeName(f.name)}` : safeName(f.name), p = folder + '/' + name, n = 2;
    while (used.has(p)) { p = folder + '/' + name.replace(/(\.\w+)?$/, m => ` (${n})` + m); n++; } used.add(p);
    z.file(p, b.blob, { binary: true });
  }
  if ((j.links || []).length) z.file('links.txt', j.links.map(l => `${l.label || ''}\t${l.url}`).join('\n'));
  onProg && onProg('Compressing…');
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' }), name: root + '.zip' };
}

/* ---------------- summaries: offline organized + online AI ---------------- */
const SECTIONS = [
  [/issue|problem|fault|alarm|found|trouble/i, 'Issues found'],
  [/program|logic|code|download|upload|change/i, 'Program changes'],
  [/test|verif|commission|check|startup/i, 'Testing & verification'],
  [/part|material|replace/i, 'Parts & materials'],
  [/customer|request/i, 'Customer requests'],
  [/safety|loto|lockout/i, 'Safety / LOTO'],
  [/follow|todo|open|pending|return/i, 'Follow-up needed'],
];
function sectionFor(tag) { for (const [re, name] of SECTIONS) if (re.test(tag || '')) return name; return 'Work performed'; }
function tidyLine(s) {
  s = String(s || '').replace(/[ \t]+/g, ' ').trim();
  if (!s) return s;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (/[A-Za-z0-9)]$/.test(s)) s += '.';
  return s;
}
function dayHours(id) {
  const cl = jobEntries(id).filter(e => e.kind !== 'note').sort((a, b) => a.ts - b.ts), out = new Map();
  let open = null;
  for (const e of cl) {
    if (e.kind === 'arrive') { if (open == null) open = e.ts; }
    else if (open != null) { const k = new Date(open).toDateString(); out.set(k, (out.get(k) || 0) + (e.ts - open)); open = null; }
  }
  if (open != null) { const k = new Date(open).toDateString(); out.set(k, (out.get(k) || 0) + (Date.now() - open)); }
  return out;
}
function buildOrganized(id) {
  const j = jobById(id) || {}, L = [];
  const notes = jobEntries(id).filter(e => e.kind === 'note').sort((a, b) => a.ts - b.ts);
  L.push(`${j.number ? j.number + ' — ' : ''}${j.title || 'Untitled job'}`);
  const who = [j.customer, j.site].filter(Boolean).join(', ');
  if (who) L.push(who);
  const facts = [j.jobType, j.platform, j.status && 'Status: ' + j.status, j.po && 'PO/WO: ' + j.po].filter(Boolean);
  if (facts.length) L.push(facts.join(' · '));
  if (notes.length) L.push(`Dates: ${shortDate(notes[0].ts)}${new Date(notes[0].ts).toDateString() !== new Date(notes[notes.length - 1].ts).toDateString() ? ' – ' + shortDate(notes[notes.length - 1].ts) : ''}`);
  const dh = dayHours(id);
  if (dh.size) L.push(`Time on site: ${hmDur(clockInfo(id).total)} (${[...dh].map(([k, ms]) => shortDate(new Date(k).getTime()) + ' ' + hmDur(ms)).join(', ')})`);
  if (!notes.length) { L.push('', 'No notes logged yet.'); return L.join('\n'); }
  const groups = new Map();
  for (const e of notes) { const s = sectionFor(e.tag); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(e); }
  const order = ['Work performed', ...SECTIONS.map(s => s[1])];
  for (const name of order) {
    const es = groups.get(name); if (!es) continue;
    L.push('', name.toUpperCase());
    for (const e of es) {
      const lines = String(e.text || '').split('\n').map(tidyLine).filter(Boolean);
      const where = e.equipment ? `${e.equipment}: ` : '';
      const fs = entryFiles(e.id);
      L.push(`- ${shortDate(e.ts)} ${hm(e.ts)} — ${where}${lines[0] || (fs.length ? 'See attached.' : '')}`);
      for (const extra of lines.slice(1)) L.push(`    ${extra}`);
      if (fs.length) L.push(`    Attached: ${fs.map(f => f.name).join(', ')}`);
    }
  }
  const docs = jobFiles(id).filter(f => !f.entryId);
  if (docs.length) { L.push('', 'JOB FILES'); for (const f of docs) L.push(`- ${f.category ? f.category + ': ' : ''}${f.name}${f.note ? ' — ' + f.note : ''}`); }
  return L.join('\n');
}

async function askClaude(system, user, maxTokens) {
  if (!S.ai.key) throw new Error('Add your API key on the Settings tab first.');
  if (!navigator.onLine) throw new Error('No connection right now. AI help works when you have signal.');
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': S.ai.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: S.ai.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
  } catch { throw new Error('Can’t reach the AI service. The network here may block it. Try again on cell data.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (data.error && data.error.message) || '';
    if (r.status === 401) throw new Error('The API key was rejected. Check it on the Settings tab.');
    if (r.status === 404) throw new Error('That AI model isn’t available on your account. Pick the other model on the Settings tab.');
    if (r.status === 429) throw new Error('Too many requests. Wait a minute and try again.');
    if (r.status >= 500) throw new Error('The AI service is busy. Try again in a minute.');
    throw new Error(m || `AI request failed (${r.status}).`);
  }
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}
const TIDY_SYSTEM = `You clean up quick field notes written by an industrial controls field service programmer (PLCs, HMIs, drives, panels, networks).
Rewrite the note so it is clear, correctly spelled and easy to read later. Keep it about the same length or shorter, written as terse past-tense work notes (no "I" needed).
Rules:
- Never add facts, causes, values, part numbers or steps that are not in the note.
- Keep tag names, routine and rung names, file names, IP addresses, model and part numbers, and units exactly as written.
- Expand shorthand only when the meaning is certain. If something is unclear, leave it as written.
- If the note lists several actions, put each on its own line starting with "- ".
Return only the rewritten note, with no preamble or quotes.`;
const SUMMARY_SYSTEM = `You write service reports for an industrial controls field service programmer (PLCs, HMIs, drives, panels, networks) from their job log.
Write a clean, organized report a customer or manager can read quickly.
Rules:
- Use only information in the log. Never invent causes, results, values, part numbers or recommendations.
- Keep tag names, routine names, file names, IP addresses, model and part numbers exactly as written.
- If the log is unclear about something, say it plainly or leave it out. Do not guess.
- Plain text only. No markdown, no asterisks, no bold. Section headings in CAPITALS on their own line. Bullets start with "- ".
Use these sections, in this order, and leave out any section the log has nothing for:
SUMMARY (2 to 4 sentences: what the job was and where it stands)
WORK PERFORMED (grouped by date, with equipment or area where given)
ISSUES FOUND
PROGRAM CHANGES (what changed, where, and file or revision names if logged)
TESTING & VERIFICATION
PARTS & MATERIALS
FOLLOW-UP / OPEN ITEMS
TIME ON SITE
Return only the report.`;

function summaryStale(j) { return j.summary && jobEntries(j.id).some(e => (e.createdAt || e.ts) > j.summary.at); }
function openSummary() { const j = jobById(S.jobId); S.sumView = j && j.summary ? 'ai' : 'organized'; drawSummary(); }
function drawSummary() {
  const j = jobById(S.jobId); if (!j) return;
  const v = S.sumView, views = [['organized', 'Organized'], ['ai', 'AI summary'], ['log', 'Full log']];
  let body = '', actions = '';
  if (v === 'organized') {
    body = `<p class="muted" style="margin:0">Your notes sorted into sections by tag, with spacing and punctuation cleaned up. Works offline.</p><textarea id="report-text" readonly>${esc(buildOrganized(j.id))}</textarea>`;
  } else if (v === 'log') {
    body = `<p class="muted" style="margin:0">Every entry exactly as logged, in time order.</p><textarea id="report-text" readonly>${esc(buildReport(j.id))}</textarea>`;
  } else if (j.summary) {
    body = `${summaryStale(j) ? `<div class="banner"><span class="grow">You’ve logged more since this summary was written.</span>${S.ai.key ? `<button class="btn small" data-act="genSummary">Rewrite</button>` : ''}</div>` : ''}
      <p class="muted" style="margin:0">Written ${esc(new Date(j.summary.at).toLocaleString())}${j.summary.edited ? ', edited by you' : ''}. Check it against your notes, edit anything, then save.</p>
      <textarea id="report-text">${esc(j.summary.text)}</textarea>`;
    actions = `<button class="btn" data-act="saveSummaryEdit">Save edits</button>${S.ai.key ? `<button class="btn ghost" data-act="genSummary">Rewrite with AI</button>` : ''}`;
  } else if (!S.ai.key) {
    body = `<div class="empty"><b>AI summaries are off.</b><span>Add your Anthropic API key on the Settings tab. When you have signal, AI writes a clean service report from this job’s log. The Organized view works without it.</span></div>`;
  } else {
    body = `<div class="empty"><b>Write a clean report from this job’s log.</b><span>AI reads your notes, tags, equipment and file names, then writes an organized summary. It only uses what you logged. Needs a connection.</span><div><button class="btn primary" data-act="genSummary">Write summary with AI</button></div></div>`;
  }
  const hasText = v !== 'ai' || j.summary;
  openSheet(`<div class="row"><h2 class="grow">Job summary</h2><button class="btn small" data-act="closeSheet">Close</button></div>
    <div class="seg">${views.map(([k, l]) => `<button data-act="sumView" data-v="${k}" class="${v === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${body}<span class="progress" id="sum-prog"></span>
    ${hasText ? `<div class="row"><button class="btn primary" data-act="copyReport">Copy</button><button class="btn" data-act="saveReport">Save / Share .txt</button>${actions}</div>` : ''}`);
}

/* ---------------- viewer & sheet ---------------- */
async function openViewer(id) {
  const f = S.files.find(x => x.id === id); if (!f) return;
  if (isPdf(f)) { const u = await urlFor(id); const w = u && window.open(u, '_blank'); if (!w) saveStored(id); return; }
  const items = isMedia(f) ? jobFiles(f.jobId).filter(isMedia).sort((a, b) => b.at - a.at) : [f];
  S.viewer = { items, i: Math.max(0, items.findIndex(x => x.id === id)) };
  $('#viewer').hidden = false; drawViewer();
}
async function drawViewer() {
  const { items, i } = S.viewer, f = items[i], body = $('#v-body');
  $('#v-prev').hidden = $('#v-next').hidden = items.length < 2;
  const e = f.entryId ? S.entries.find(x => x.id === f.entryId) : null;
  $('#v-meta').textContent = [items.length > 1 ? `${i + 1} / ${items.length}` : '', new Date(f.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), f.name].filter(Boolean).join(' · ');
  $('#v-cap').textContent = [e && [e.tag, e.equipment].filter(Boolean).join(' · '), e && e.text, f.note].filter(Boolean).join('\n');
  body.innerHTML = '';
  if (isText(f) && !isMedia(f)) {
    const r = await DB.get('blobs', f.id); const txt = r ? await r.blob.slice(0, 400000).text() : '';
    const pre = document.createElement('pre'); pre.textContent = txt + (r && r.blob.size > 400000 ? '\n\n… (preview cut off — use Save / Share for the full file)' : ''); body.appendChild(pre); return;
  }
  const u = await urlFor(f.id); if (!u) { body.textContent = 'File missing.'; return; }
  const el = document.createElement(isVid(f) ? 'video' : 'img');
  if (isVid(f)) { el.controls = true; el.playsInline = true; } else el.alt = f.name;
  el.src = u; body.appendChild(el);
}
function closeViewer() { const v = $('#v-body video'); if (v) v.pause(); $('#viewer').hidden = true; S.viewer = null; }
function openSheet(html) { $('#sheet-panel').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-panel').innerHTML = ''; }

/* ---------------- actions ---------------- */
const ACTS = {
  back() { go('jobs'); },
  newJob() { go('new'); },
  filter(b) { S.filter = b.dataset.f; drawBelow(); },
  tab(b) { saveDraft(); S.tab = b.dataset.t; S.editing = null; S.editingFile = null; renderJob(); },
  pick(b) { $('#' + b.dataset.in).click(); },
  unstage(b) { const p = S.pending.splice(+b.dataset.i, 1)[0]; if (p && p.url) URL.revokeObjectURL(p.url); drawStaged(); },
  openHit(b) { S.focus = b.dataset.entry ? { entry: b.dataset.entry } : { file: b.dataset.file }; S.tab = b.dataset.entry ? 'log' : 'files'; go('job-' + b.dataset.job); },

  async saveEntry(b) {
    if (S.busy) return;
    const text = $('#c-text').value.trim(), tag = selVal('c-tag'), equipment = selVal('c-equip'), tv = $('#c-time').value;
    if (!text && !S.pending.length) { toast('Write a note or add a photo first.'); return; }
    const ts = tv ? new Date(tv).getTime() : Date.now(), jobId = S.jobId, id = uid(), prog = $('#c-prog');
    S.busy = true; b.disabled = true;
    try {
      const { metas, ops } = await ingest(S.pending.map(p => p.file), { jobId, entryId: id, at: ts }, (i, n) => (prog.textContent = `Processing ${i + 1} of ${n}…`));
      prog.textContent = 'Saving…';
      const entry = { id, jobId, kind: 'note', ts, tag, equipment, text, createdAt: Date.now() };
      const job = jobTouched(jobById(jobId), ts, text || `${metas.length} attachment${metas.length === 1 ? '' : 's'}`);
      await DB.batch([...ops, ['put', 'entries', entry], ['put', 'jobs', job]]);
      S.entries.push(entry); S.files.push(...metas); upsert(S.jobs, job);
      clearPending(); clearDraft(jobId);
      if (metas.length) askPersist();
      if (S.jobId === jobId && $('#c-text')) { $('#c-text').value = ''; $('#c-time').value = ''; drawStaged(); drawTimeline(); }
      toast('Saved at ' + hm(ts));
    } catch (e) { toast('Could not save: ' + (e && e.message || 'storage error') + '. Your note is still here.'); }
    finally { prog.textContent = ''; S.busy = false; b.disabled = false; }
  },
  async clock(b) {
    const kind = b.dataset.k, ts = Date.now(), entry = { id: uid(), jobId: S.jobId, kind, ts, tag: '', equipment: '', text: '', createdAt: ts };
    const job = jobTouched(jobById(S.jobId), ts, kind === 'arrive' ? 'Arrived on site' : 'Left site');
    try { await DB.batch([['put', 'entries', entry], ['put', 'jobs', job]]); S.entries.push(entry); upsert(S.jobs, job); drawClock(); drawTimeline(); toast((kind === 'arrive' ? 'Arrived ' : 'Left ') + hm(ts)); }
    catch { toast('Could not save. Try again.'); }
  },
  editEntry(b) { S.editing = b.dataset.id; drawTimeline(); const t = $('#ed-text') || $('#ed-time'); if (t) t.focus(); },
  cancelEdit() { S.editing = null; drawTimeline(); },
  async saveEdit(b) {
    const e = S.entries.find(x => x.id === b.dataset.id); if (!e) return;
    const tv = ($('#ed-time') || {}).value, next = { ...e };
    if (tv) next.ts = new Date(tv).getTime();
    if (e.kind === 'note') { next.text = $('#ed-text').value.trim(); next.tag = selVal('ed-tag'); next.equipment = selVal('ed-equip'); }
    try {
      const job = jobTouched(jobById(e.jobId), next.ts, e.kind === 'note' ? next.text : null);
      await DB.batch([['put', 'entries', next], ['put', 'jobs', job]]); upsert(S.entries, next); upsert(S.jobs, job);
      S.editing = null; drawTimeline(); toast('Entry updated');
    } catch { toast('Could not save the change.'); }
  },
  async delEntry(b) {
    if (!armed(b)) return;
    const e = S.entries.find(x => x.id === b.dataset.id); if (!e) return;
    const fs = entryFiles(e.id);
    try { await DB.batch([['del', 'entries', e.id], ...fileDeleteOps(fs)]); S.entries = S.entries.filter(x => x.id !== e.id); S.files = S.files.filter(f => f.entryId !== e.id); fs.forEach(f => dropUrl(f.id)); drawClock(); drawTimeline(); toast('Entry deleted'); }
    catch { toast('Could not delete the entry.'); }
  },
  view(b) { openViewer(b.dataset.id); },
  vPrev() { const v = S.viewer; v.i = (v.i - 1 + v.items.length) % v.items.length; drawViewer(); },
  vNext() { const v = S.viewer; v.i = (v.i + 1) % v.items.length; drawViewer(); },
  vClose: closeViewer,
  vSave() { saveStored(S.viewer.items[S.viewer.i].id); },
  saveFile(b) { saveStored(b.dataset.id); },
  editFile(b) { S.editingFile = b.dataset.id; S.tab === 'files' ? drawFiles() : drawTimeline(); },
  cancelFileEdit() { S.editingFile = null; S.tab === 'files' ? drawFiles() : drawTimeline(); },
  async delFile(b) {
    if (!armed(b)) return;
    const f = S.files.find(x => x.id === b.dataset.id); if (!f) return;
    try { await DB.batch(fileDeleteOps([f])); S.files = S.files.filter(x => x.id !== f.id); dropUrl(f.id); S.tab === 'files' ? drawFiles() : drawTimeline(); toast('File deleted'); }
    catch { toast('Could not delete the file.'); }
  },
  async addLink() {
    const label = $('#l-label').value.trim(); let url = $('#l-url').value.trim();
    if (!url) { toast('Paste the link address first.'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch { toast('That doesn’t look like a web address.'); return; }
    const j = jobById(S.jobId), job = { ...j, links: [...(j.links || []), { label, url, at: Date.now() }], updatedAt: Date.now() };
    await saveJob(job); $('#l-label').value = ''; $('#l-url').value = ''; drawFiles(); toast('Link added');
  },
  async rmLink(b) { if (!armed(b)) return; const j = jobById(S.jobId); await saveJob({ ...j, links: (j.links || []).filter(l => l.url !== b.dataset.url), updatedAt: Date.now() }); drawFiles(); },
  async delJob(b) {
    if (!armed(b)) return;
    const id = S.jobId, es = jobEntries(id), fs = jobFiles(id);
    try {
      await DB.batch([['del', 'jobs', id], ...es.map(e => ['del', 'entries', e.id]), ...fileDeleteOps(fs)]);
      S.jobs = S.jobs.filter(j => j.id !== id); S.entries = S.entries.filter(e => e.jobId !== id); S.files = S.files.filter(f => f.jobId !== id); fs.forEach(f => dropUrl(f.id)); clearDraft(id);
      go('jobs'); toast('Job deleted');
    } catch { toast('Could not delete the job.'); }
  },
  openSummary,
  sumView(b) { S.sumView = b.dataset.v; drawSummary(); },
  async genSummary(b) {
    if (S.aiBusy) return; S.aiBusy = true;
    const id = S.jobId; b.disabled = true; const prog = $('#sum-prog'); if (prog) prog.textContent = 'Writing summary…';
    try {
      const text = await askClaude(SUMMARY_SYSTEM, 'Job log:\n\n' + buildReport(id), 3000);
      const j = jobById(id);
      await saveJob({ ...j, summary: { text, at: Date.now(), model: S.ai.model, edited: false }, updatedAt: Date.now() });
      if (S.jobId === id && !$('#sheet').hidden) { S.sumView = 'ai'; drawSummary(); }
      toast('Summary written. Check it before sending.');
    } catch (e) { if (prog) prog.textContent = ''; b.disabled = false; toast(e.message); }
    finally { S.aiBusy = false; }
  },
  async saveSummaryEdit() {
    const j = jobById(S.jobId); if (!j || !j.summary) return;
    await saveJob({ ...j, summary: { ...j.summary, text: $('#report-text').value, edited: true }, updatedAt: Date.now() });
    toast('Summary saved'); drawSummary();
  },
  async tidy(b) {
    const t = $('#c-text'), before = t.value.trim();
    if (!before) { toast('Write a note first, then tidy it.'); return; }
    if (S.aiBusy) return; S.aiBusy = true; b.disabled = true; const label = b.textContent; b.textContent = 'Tidying…';
    try {
      const out = await askClaude(TIDY_SYSTEM, before, 800);
      if (out && $('#c-text') === t) { S.tidyUndo = t.value; t.value = out; saveDraft(); $('#c-undo').hidden = false; }
    } catch (e) { toast(e.message); }
    finally { S.aiBusy = false; b.disabled = false; b.textContent = label; }
  },
  undoTidy(b) { if (S.tidyUndo != null) { $('#c-text').value = S.tidyUndo; S.tidyUndo = null; saveDraft(); } b.hidden = true; },
  async saveAi() {
    const key = $('#ai-key').value.trim();
    S.ai = { key, model: $('#ai-model').value };
    await saveConfig('ai', S.ai); toast(key ? 'AI help is on' : 'AI help is off'); renderBackup();
  },
  async testAi(b) {
    const key = $('#ai-key').value.trim(); if (!key) { toast('Paste your API key first.'); return; }
    const prev = S.ai; S.ai = { key, model: $('#ai-model').value }; b.disabled = true; b.textContent = 'Testing…';
    try { await askClaude('Reply with the single word: ready', 'Test', 10); toast('Connected. AI help works.'); }
    catch (e) { toast(e.message); }
    finally { S.ai = prev; b.disabled = false; b.textContent = 'Test'; }
  },
  async removeAi() { S.ai = { key: '', model: S.ai.model }; await saveConfig('ai', S.ai); toast('API key removed from this phone'); renderBackup(); },
  copyReport() {
    const t = $('#report-text');
    const fallback = () => { t.focus(); t.select(); try { document.execCommand('copy'); toast('Report copied'); } catch { toast('Text selected. Use Copy from the menu.'); } };
    if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(() => toast('Report copied'), fallback); else fallback();
  },
  saveReport() { const j = jobById(S.jobId), kind = { organized: 'summary', ai: 'AI summary', log: 'full log' }[S.sumView] || 'report'; offerSave(new Blob([$('#report-text').value], { type: 'text/plain' }), `${safeName(jobLabel(j))} ${kind}.txt`); },
  closeSheet,
  async finishSave() { const p = pendingSave; pendingSave = null; closeSheet(); if (p && (await offerSave(p.blob, p.name)) && p.name.startsWith('Jobflow backup')) markBackedUp(); },
  async exportJob(b) {
    b.disabled = true; const t = b.textContent;
    try { const { blob, name } = await buildJobZip(S.jobId, m => (b.textContent = m)); b.textContent = t; await offerSave(blob, name); }
    catch (e) { toast('Export failed: ' + (e.message || e)); }
    finally { b.disabled = false; b.textContent = t; }
  },
  async backupAll(b) {
    const prog = $('#b-prog'); b.disabled = true;
    try {
      const blob = await buildBackup(m => (prog.textContent = m));
      prog.textContent = '';
      const d = new Date(), name = `Jobflow backup ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`;
      const ok = await offerSave(blob, name);
      if (ok) await markBackedUp();
    } catch (e) { prog.textContent = ''; toast('Backup failed: ' + (e.message || e)); }
    finally { if ($('[data-act="backupAll"]')) $('[data-act="backupAll"]').disabled = false; }
  },
  async confirmRestore(b) {
    const r = S.restore; if (!r) return; b.disabled = true;
    const prog = $('#rs-prog');
    try { await applyBackup(r, m => (prog.textContent = m)); S.restore = null; closeSheet(); toast(`Restored ${r.meta.jobs.length} jobs`); render(); }
    catch (e) { b.disabled = false; prog.textContent = ''; toast('Restore failed: ' + (e.message || e)); }
  },
  async persist() { try { const ok = await navigator.storage.persist(); toast(ok ? 'Data is protected from automatic cleanup.' : 'The browser didn’t allow it. Installing to the home screen usually fixes this.'); } catch { toast('Not supported on this browser.'); } drawStorage(); },
  applyUpdate() { if (swReg && swReg.waiting) swReg.waiting.postMessage('SKIP_WAITING'); else location.reload(); },
  async addOpt(b) {
    const sel = $('#' + b.dataset.for), inp = $('#' + b.dataset.for + '-new'), v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    const k = sel.dataset.list, next = clone(S.lists); next[k] = list(k).slice();
    let val = next[k].find(x => x.toLowerCase() === v.toLowerCase());
    if (!val) { next[k].push(v); val = v; }
    await saveLists(next); refillSelects();
    sel.value = val; sel.dataset.prev = val; inp.value = ''; inp.closest('.addrow').hidden = true;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  },
  cancelOpt(b) { const sel = $('#' + b.dataset.for); sel.value = sel.dataset.prev || ''; $('#' + b.dataset.for + '-new').closest('.addrow').hidden = true; },
  async optAdd(b) {
    const k = b.dataset.k, inp = $('#new-' + k), v = inp.value.trim(); if (!v) return;
    if (list(k).some(x => x.toLowerCase() === v.toLowerCase())) { toast(`“${v}” is already on the list.`); return; }
    const next = clone(S.lists); next[k] = [...list(k), v]; await saveLists(next); drawLists(); $('#new-' + k).focus();
  },
  async optRm(b) { const k = b.dataset.k, next = clone(S.lists); next[k] = list(k).filter((_, i) => i !== +b.dataset.i); await saveLists(next); drawLists(); },
  async optUp(b) { const k = b.dataset.k, i = +b.dataset.i, a = list(k).slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; const next = clone(S.lists); next[k] = a; await saveLists(next); drawLists(); },
};
const SUBMITS = {
  async saveInfo() {
    const d = readInfo();
    if (!d.title && !d.number) { toast('Give the job a number or a title.'); return; }
    try {
      if (S.route === 'new') { const job = { id: uid(), ...d, links: [], createdAt: Date.now(), updatedAt: Date.now(), lastEntryAt: 0, lastNote: '' }; await saveJob(job); S.tab = 'log'; go('job-' + job.id); toast('Job created'); }
      else { const j = jobById(S.jobId); await saveJob({ ...j, ...d, updatedAt: Date.now() }); drawJobHead(); drawHdr(d.number || 'Job', true); toast('Saved'); }
    } catch { toast('Could not save the job.'); }
  },
  async saveFileEdit(form) {
    const f = S.files.find(x => x.id === form.dataset.id); if (!f) return;
    const next = { ...f, name: $('#fe-name').value.trim() || f.name, category: selVal('fe-cat'), note: $('#fe-note').value.trim() };
    try { await DB.put('files', next); upsert(S.files, next); S.editingFile = null; S.tab === 'files' ? drawFiles() : drawTimeline(); toast('File updated'); }
    catch { toast('Could not save the change.'); }
  },
};

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const fn = ACTS[t.dataset.act]; if (!fn) return;
  e.preventDefault(); fn(t, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-act-submit]'); if (!f) return;
  e.preventDefault(); SUBMITS[f.dataset.actSubmit](f);
});
document.addEventListener('keydown', e => {
  if (S.viewer) { if (e.key === 'Escape') closeViewer(); if (e.key === 'ArrowLeft') ACTS.vPrev(); if (e.key === 'ArrowRight') ACTS.vNext(); return; }
  if (e.key === 'Escape' && !$('#sheet').hidden) return closeSheet();
  if (e.key !== 'Enter' || !e.target.id) return;
  if (e.target.id.startsWith('new-')) { e.preventDefault(); ACTS.optAdd({ dataset: { k: e.target.dataset.k } }); }
  else if (e.target.id.endsWith('-new')) { e.preventDefault(); ACTS.addOpt({ dataset: { for: e.target.id.slice(0, -4) } }); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { S.q = e.target.value; drawBelow(); }
  if (e.target.id === 'c-text') saveDraft();
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches('select[data-list]')) {
    if (t.value === '__add') { const row = t.parentElement.querySelector('.addrow'); row.hidden = false; row.querySelector('input').focus(); return; }
    t.dataset.prev = t.value;
    if (t.id === 'c-tag' || t.id === 'c-equip') saveDraft();
    if (t.id === 'j-cat') { try { localStorage.setItem('jf-lastcat', t.value); } catch {} }
    if (t.id === 'hdr-status') { const j = jobById(S.jobId); await saveJob({ ...j, status: t.value, updatedAt: Date.now() }); toast('Status: ' + (t.value || 'none')); }
    return;
  }
  if (t.id === 'c-time') saveDraft();
  if (t.id === 's-photo') { S.settings.photoMax = +t.value; await saveConfig('settings', S.settings); toast('Photo size saved'); }
  if (t.id === 'c-photo' || t.id === 'c-file') {
    for (const f of t.files) S.pending.push({ file: f, url: isImg(f) && !/heic|heif/i.test(f.type) ? URL.createObjectURL(f) : null });
    S.pendingFor = S.jobId; t.value = ''; drawStaged();
  }
  if (t.id === 'ed-add') {
    const files = [...t.files], entryId = t.dataset.entry, e0 = S.entries.find(x => x.id === entryId); t.value = '';
    if (!files.length || !e0) return;
    const prog = $('#ed-prog');
    try {
      const { metas, ops } = await ingest(files, { jobId: e0.jobId, entryId, at: e0.ts }, (i, n) => prog && (prog.textContent = `Processing ${i + 1} of ${n}…`));
      await DB.batch(ops); S.files.push(...metas); askPersist();
      if (prog) prog.textContent = ''; toast(`${metas.length} added to entry`);
    } catch (err) { if (prog) prog.textContent = ''; toast('Could not add: ' + (err.message || err)); }
  }
  if (t.id === 'j-file') {
    const files = [...t.files]; t.value = ''; if (!files.length) return;
    const prog = $('#j-prog'), jobId = S.jobId;
    try {
      const { metas, ops } = await ingest(files, { jobId, category: selVal('j-cat'), note: ($('#j-note') || {}).value?.trim() || '' }, (i, n) => (prog.textContent = `Processing ${i + 1} of ${n}…`));
      const job = { ...jobById(jobId), updatedAt: Date.now() };
      await DB.batch([...ops, ['put', 'jobs', job]]); S.files.push(...metas); upsert(S.jobs, job); askPersist();
      prog.textContent = ''; if ($('#j-note')) $('#j-note').value = ''; drawFiles(); toast(`${metas.length} file${metas.length === 1 ? '' : 's'} added`);
    } catch (err) { prog.textContent = ''; toast('Could not add files: ' + (err.message || err)); }
  }
  if (t.id === 'r-file') {
    const file = t.files[0]; t.value = ''; if (!file) return;
    const prog = $('#r-prog'); prog.textContent = 'Reading backup…';
    try {
      S.restore = await readBackup(file); prog.textContent = '';
      const m = S.restore.meta;
      openSheet(`<h2>Restore this backup?</h2><dl class="kv"><dt>Made</dt><dd>${esc(new Date(m.exportedAt).toLocaleString())}</dd><dt>Jobs</dt><dd>${(m.jobs || []).length}</dd><dt>Log entries</dt><dd>${(m.entries || []).length}</dd><dt>Files</dt><dd>${(m.files || []).length}</dd></dl>
        <p class="muted" style="margin:0">Jobs in the backup are added to this phone. If a job is already here, the backup's version replaces it.</p>
        <div class="row"><button class="btn primary" data-act="confirmRestore">Restore</button><button class="btn ghost" data-act="closeSheet">Cancel</button><span class="progress grow" id="rs-prog"></span></div>`);
    } catch (err) { prog.textContent = ''; toast(err.message || 'Could not read that file.'); }
  }
});
window.addEventListener('hashchange', route);
setInterval(() => { if (S.route === 'job' && S.tab === 'log') drawClock(); }, 60000);

/* ---------------- boot ---------------- */
async function loadAll() {
  const [jobs, entries, files, cfg] = await Promise.all([DB.getAll('jobs'), DB.getAll('entries'), DB.getAll('files'), DB.getAll('config')]);
  S.jobs = jobs; S.entries = entries; S.files = files;
  const c = Object.fromEntries(cfg.map(x => [x.key, x.value]));
  S.lists = c.lists || null; S.settings = { photoMax: 3000, ...(c.settings || {}) }; S.lastBackup = c.lastBackup || 0;
  S.ai = { key: '', model: 'claude-sonnet-5-5', ...(c.ai || {}) };
  if (!S.lists) { S.lists = clone(DEFAULT_LISTS); await saveConfig('lists', S.lists); }
  for (const k of Object.keys(DEFAULT_LISTS)) if (!Array.isArray(S.lists[k])) S.lists[k] = clone(DEFAULT_LISTS[k]);
}
async function boot() {
  try { await loadAll(); }
  catch (e) { $('#view').innerHTML = `<div class="empty"><b>Jobflow can’t open its storage.</b><span>${esc(e.message || e)}. Private browsing blocks storage. Open Jobflow in a normal browser window or from your home screen.</span></div>`; return; }
  S.ready = true; route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      const hadController = !!navigator.serviceWorker.controller; // first install must not reload the page
      swReg = await navigator.serviceWorker.register('sw.js');
      const flag = () => { updateReady = true; if (S.route === 'jobs' || S.route === 'backup') render(); };
      if (swReg.waiting && navigator.serviceWorker.controller) flag();
      swReg.addEventListener('updatefound', () => { const w = swReg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) flag(); }); });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    } catch {}
  }
}
window.__jobflow = { S, DB }; // for troubleshooting from the browser console
boot();
