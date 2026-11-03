// The Productivity Matrix: a scrappy 2×2 board for sorting your day.
// Plain JS, no build step. Everything is saved in localStorage on this device.

const STORE_KEY = 'pm.v1';
const DAY = 86400000;
const ZONES = ['red', 'green', 'yellow', 'blue', 'desk'];
const ZONE_INFO = {
  red: ['RED', 'want to, but should absolutely NOT'],
  green: ['GREEN', 'want to, and absolutely should'],
  yellow: ['YELLOW', "don't want to, don't need to"],
  blue: ['BLUE', "don't want to, but have to"],
  desk: ['THE DESK', 'not on the board yet'],
};
const STORM_CHOICES = [15, 30, 45, 60];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const sheetDlg = $('#sheet');
const takeover = $('#takeover');
const toastEl = $('#toast');

let state;
let zoomed = null;
let drag = null;
let stormMinutes = 45;
let wake = null;
let onSheetAct = null;
let onTakeoverAct = null;
let sheetDirty = false;

/* ---------- small helpers ---------- */

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function rand(a, b) { return a + Math.random() * (b - a); }
function tilt() { return Math.round(rand(-3.5, 3.5) * 10) / 10; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function buzz(pattern) { navigator.vibrate?.(pattern); }
function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Seeded randomness, so each scrap keeps the same torn edges and tally wobble.
function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isToday(ts) { return new Date(ts).toDateString() === new Date().toDateString(); }
function talliesToday(s) { return s.tallies.filter(isToday).length; }
function age(ts) {
  const d = Math.floor((Date.now() - ts) / DAY);
  return d < 1 ? 'since today' : d === 1 ? 'since yesterday' : `for ${d} days`;
}
function dayLabel(ts) {
  const d = new Date(ts).toDateString();
  if (d === new Date().toDateString()) return 'TODAY';
  if (d === new Date(Date.now() - DAY).toDateString()) return 'YESTERDAY';
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}
function duration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function clock(ms, withHours = false) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h || withHours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
// Fixed-width digits so the marker clock doesn't jiggle every second.
function clockHTML(text) {
  return [...text].map(c => `<span class="${c === ':' ? 'c' : 'd'}">${c}</span>`).join('');
}

/* ---------- state ---------- */

function randomSpot(zone) {
  return zone === 'desk' ? [rand(0.02, 0.6), rand(0.08, 0.4)] : [rand(0.06, 0.5), rand(0.14, 0.6)];
}

function newScrap(text, zone) {
  const [x, y] = randomSpot(zone);
  return { id: uid(), text, zone, x, y, r: tilt(), createdAt: Date.now(), doneAt: null, tallies: [], focusMs: 0, delegate: false };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.scraps)) return saved;
  } catch {}
  return { scraps: [newScrap('DRAG ME ONTO THE BOARD', 'desk')], lock: null, storm: null };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast("Couldn't save. Your browser storage might be full.");
  }
}

const find = id => state.scraps.find(s => s.id === id);
const scrapEl = id => $(`[data-zone] > .scrap[data-id="${id}"]`);

/* ---------- drawing the board ---------- */

function render() {
  $$('[data-zone] > .scrap').forEach(n => n.remove());
  for (const s of state.scraps) {
    if (s.doneAt) continue;
    $(`[data-zone="${s.zone}"]`)?.append(buildScrap(s));
  }
  $$('[data-zone] > .scrap').forEach(fit);
  $('#pile-count').textContent = state.scraps.filter(s => s.doneAt).length;
}

function buildScrap(s) {
  const el = document.createElement('div');
  const today = s.zone === 'red' ? talliesToday(s) : 0;
  el.className = 'scrap';
  el.dataset.id = s.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${s.text}${today ? `, gave in ${today} time${today === 1 ? '' : 's'} today` : ''}`);
  el.style.setProperty('--r', `${s.r}deg`);
  el.style.left = `${s.x * 100}%`;
  el.style.top = `${s.y * 100}%`;
  el.innerHTML = `<div class="cut" style="clip-path: ${edge(s.id)}"><span class="ink">${esc(s.text)}${
    s.zone === 'blue' && s.delegate ? '<span class="flag">DELEGATE?</span>' : ''}${
    today ? `<span class="tally">${tallyMarks(today, s.id)}</span>` : ''}</span></div>`;
  return el;
}

// Keep a scrap inside its zone, e.g. when the screen is narrower than where it was placed.
function fit(el) {
  const zone = el.parentElement, s = find(el.dataset.id);
  const maxX = Math.max(0, 1 - el.offsetWidth / zone.clientWidth);
  const maxY = Math.max(0, 1 - el.offsetHeight / zone.clientHeight);
  el.style.left = `${Math.min(s.x, maxX) * 100}%`;
  el.style.top = `${Math.min(s.y, maxY) * 100}%`;
}

// Slightly uneven scissor cuts.
function edge(id) {
  const r = rng(hash(id) ^ 0x9e37);
  const j = () => Math.round(r() * 4);
  return `polygon(${j()}px ${j()}px, calc(100% - ${j()}px) ${j()}px, calc(100% - ${j()}px) calc(100% - ${j()}px), ${j()}px calc(100% - ${j()}px))`;
}

// Hand-drawn tally marks in groups of five.
function tallyMarks(n, id) {
  const r = rng(hash(id));
  const j = () => ((r() - 0.5) * 2.2).toFixed(1);
  let out = '';
  for (let left = Math.min(n, 20); left > 0; left -= 5) {
    const group = Math.min(5, left);
    let lines = '';
    for (let i = 0; i < Math.min(group, 4); i++) {
      const x = 4 + i * 5.5;
      lines += `<path d="M${x + +j()} ${2 + +j()} L${x + +j()} ${17 + +j()}"/>`;
    }
    if (group === 5) lines += `<path d="M${1 + +j()} ${14 + +j()} L${24 + +j()} ${5 + +j()}"/>`;
    out += `<svg viewBox="0 0 26 19" aria-hidden="true">${lines}</svg>`;
  }
  if (n > 20) out += `<span class="more">+${n - 20}</span>`;
  return out;
}

function land(id) {
  const el = scrapEl(id);
  if (!el) return;
  el.classList.add('landed');
  el.addEventListener('animationend', () => el.classList.remove('landed'), { once: true });
  buzz(10);
}

function callout(id) {
  if (zoomed) zoomTo(null);
  const el = scrapEl(id);
  if (!el) return;
  el.classList.add('callout');
  setTimeout(() => el.classList.remove('callout'), 4500);
}

/* ---------- zooming into a quadrant ---------- */

function zoomTo(zone) {
  const grid = $('#grid'), view = $('#grid-view');
  zoomed = zone;
  $('#zoom-out').hidden = !zone;
  if (!zone) {
    // Keep clipping until the camera has pulled all the way back.
    grid.style.transform = '';
    if (reducedMotion()) view.classList.remove('zoomed');
    return;
  }
  const quad = $(`.quad[data-zone="${zone}"]`);
  const W = grid.offsetWidth, H = grid.offsetHeight, qw = quad.offsetWidth, qh = quad.offsetHeight;
  const s = Math.min(W / qw, H / qh);
  const tx = -quad.offsetLeft * s + (W - qw * s) / 2;
  const ty = -quad.offsetTop * s + (H - qh * s) / 2;
  grid.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  view.classList.add('zoomed');
}

/* ---------- dragging scraps around ---------- */

// How much a zone is magnified on screen (2× when zoomed into a quadrant).
function scaleOf(zone) {
  return zone.getBoundingClientRect().width / zone.offsetWidth || 1;
}

// A floating copy of a scrap, so it can travel across zones (and out to the bin or pile).
function ghostOf(el) {
  const rect = el.getBoundingClientRect();
  const g = el.cloneNode(true);
  g.classList.add('ghost');
  g.classList.remove('landed', 'callout');
  g.removeAttribute('tabindex');
  g.removeAttribute('role');
  g.setAttribute('aria-hidden', 'true');
  g.style.width = `${el.offsetWidth}px`;
  g.style.left = `${rect.left + rect.width / 2 - el.offsetWidth / 2}px`;
  g.style.top = `${rect.top + rect.height / 2 - el.offsetHeight / 2}px`;
  g.style.setProperty('--s', scaleOf(el.parentElement));
  document.body.append(g);
  el.style.visibility = 'hidden';
  return g;
}

function targetAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('[data-zone], #bin, #pile-btn') ?? null;
}

function setHot(target) {
  if (drag.hot === target) return;
  drag.hot?.classList.remove('hot');
  target?.classList.add('hot');
  drag.hot = target;
  if (target?.dataset.zone) drag.ghost.style.setProperty('--s', scaleOf(target));
}

function endDrag() {
  const d = drag;
  drag = null;
  document.body.classList.remove('dragging');
  d.hot?.classList.remove('hot');
  return d;
}

document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-zone] > .scrap');
  if (!el || e.button > 0 || drag) return;
  e.preventDefault();
  drag = { el, id: el.dataset.id, x0: e.clientX, y0: e.clientY, pid: e.pointerId, ghost: null, hot: null };
  el.setPointerCapture?.(e.pointerId);
});

document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.ghost) {
    if (Math.hypot(dx, dy) < 6) return;
    drag.ghost = ghostOf(drag.el);
    document.body.classList.add('dragging');
    buzz(8);
  }
  drag.ghost.style.translate = `${dx}px ${dy}px`;
  setHot(targetAt(e.clientX, e.clientY));
});

document.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = endDrag();
  if (d.ghost) drop(d, targetAt(e.clientX, e.clientY));
  else openScrap(d.id);
});

document.addEventListener('pointercancel', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = endDrag();
  d.ghost?.remove();
  d.el.style.visibility = '';
});

function drop(d, target) {
  const s = find(d.id);
  if (target?.id === 'bin') {
    crumple(d.ghost, () => toss(s.id));
    return;
  }
  if (target?.id === 'pile-btn') {
    d.ghost.remove();
    d.el.style.visibility = '';
    markDone(s.id);
    return;
  }
  if (target?.dataset.zone) {
    const zr = target.getBoundingClientRect(), gr = d.ghost.getBoundingClientRect(), sc = scaleOf(target);
    const w = d.el.offsetWidth, h = d.el.offsetHeight, W = target.clientWidth, H = target.clientHeight;
    const cx = (gr.left + gr.width / 2 - zr.left) / sc;
    const cy = (gr.top + gr.height / 2 - zr.top) / sc;
    s.x = clamp((cx - w / 2) / W, 0, Math.max(0, 1 - w / W));
    s.y = clamp((cy - h / 2) / H, 0, Math.max(0, 1 - h / H));
    if (s.zone !== target.dataset.zone) {
      s.zone = target.dataset.zone;
      s.movedAt = Date.now();
    }
    s.r = tilt();
    save();
  }
  d.ghost.remove();
  render();
  land(s.id);
}

/* ---------- crumpling, finishing, moving ---------- */

function crumple(ghost, done) {
  buzz(20);
  const base = getComputedStyle(ghost).transform;
  const from = base === 'none' ? '' : base;
  ghost.animate([
    { transform: `${from} scale(1)`, opacity: 1 },
    { transform: `${from} scale(.55, .42) rotate(25deg)`, opacity: 1, offset: 0.45 },
    { transform: `${from} scale(0) rotate(140deg)`, opacity: 0 },
  ], { duration: reducedMotion() ? 1 : 420, easing: 'ease-in' }).onfinish = () => {
    ghost.remove();
    done();
  };
}

function toss(id) {
  const i = state.scraps.findIndex(s => s.id === id);
  if (i < 0) return;
  const [s] = state.scraps.splice(i, 1);
  save();
  render();
  toast(`Crumpled “${s.text}”.`, 'UNDO', () => {
    state.scraps.splice(i, 0, s);
    save();
    render();
    land(s.id);
  });
}

// Stamp it DONE, then fling it onto the pile.
function markDone(id) {
  const s = find(id);
  if (!s || s.doneAt) return;
  const finish = () => {
    s.doneAt = Date.now();
    save();
    render();
    $('#pile-btn').animate(
      [{ rotate: '0deg' }, { rotate: '-7deg', scale: 1.1 }, { rotate: '0deg' }],
      { duration: 320 },
    );
  };
  const el = scrapEl(id);
  if (!el || reducedMotion()) { finish(); return; }

  $('.cut', el).insertAdjacentHTML('beforeend', '<span class="stamp" aria-hidden="true">DONE</span>');
  buzz([12, 60, 18]);
  setTimeout(() => {
    if (!el.isConnected) { finish(); return; }
    const sc = scaleOf(el.parentElement);
    const g = ghostOf(el);
    const a = g.getBoundingClientRect(), b = $('#pile-btn').getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    g.animate([
      { translate: '0 0', transform: `rotate(${s.r}deg) scale(${sc * 1.07})`, opacity: 1 },
      { translate: `${dx}px ${dy}px`, transform: `rotate(${s.r + 30}deg) scale(.25)`, opacity: 0.5 },
    ], { duration: 550, easing: 'cubic-bezier(.55, 0, .8, .3)', fill: 'forwards' }).onfinish = () => {
      g.remove();
      finish();
    };
  }, 800);
}

function moveTo(s, zone) {
  if (s.zone !== zone) {
    [s.x, s.y] = randomSpot(zone);
    Object.assign(s, { zone, movedAt: Date.now(), r: tilt() });
  }
  save();
  render();
  land(s.id);
}

/* ---------- paper sheets (dialogs) ---------- */

function openSheet(html, onAct, { tint = '', cls = '' } = {}) {
  sheetDlg.className = `sheet ${cls}`;
  // Focus lands on the paper itself, so opening a sheet doesn't pop up a phone keyboard or a focus ring.
  sheetDlg.innerHTML = `<div class="sheet-body" tabindex="-1" autofocus${tint ? ` style="--c: var(--${tint})"` : ''}>
    <button class="x" type="button" data-act="close" aria-label="Close">×</button>${html}</div>`;
  onSheetAct = onAct;
  if (!sheetDlg.open) sheetDlg.showModal();
}

function closeSheet() {
  if (sheetDirty) { sheetDirty = false; render(); }
  if (sheetDlg.open) sheetDlg.close();
}

sheetDlg.addEventListener('click', e => {
  if (e.target === sheetDlg) { closeSheet(); return; } // tapped the backdrop
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'close') closeSheet();
  else onSheetAct?.(b.dataset.act);
});
sheetDlg.addEventListener('close', () => {
  if (sheetDirty) { sheetDirty = false; render(); }
});

function openScrap(id) {
  const s = find(id);
  if (!s) return;
  const [name, line] = ZONE_INFO[s.zone];
  const today = talliesToday(s);
  const meta = [`${s.zone === 'desk' ? 'on the desk' : 'here'} ${age(s.movedAt || s.createdAt)}`];
  if (s.zone === 'green' && s.focusMs) meta.push(`${duration(s.focusMs)} behind a locked door`);
  if (s.zone === 'red') meta.push(`gave in ${today}× today, ${s.tallies.length}× all time`);

  const locked = state.lock?.id === s.id;
  const actions = {
    green: `<button class="btn btn-go" type="button" data-act="lock">${locked ? 'BACK BEHIND THE DOOR' : 'LOCK THE DOOR'}</button>
      <button class="btn" type="button" data-act="done">DONE</button>`,
    blue: `<button class="btn" type="button" data-act="done">DONE</button>
      <button class="btn btn-ghost" type="button" data-act="delegate" aria-pressed="${s.delegate}">${s.delegate ? 'NOT DELEGATING' : 'DELEGATE?'}</button>`,
    yellow: `<button class="btn btn-yellow" type="button" data-act="start">START IT</button>
      <button class="btn" type="button" data-act="done">DONE</button>`,
    red: `<button class="btn btn-red" type="button" data-act="tally">I GAVE IN</button>
      ${today ? '<button class="btn btn-ghost" type="button" data-act="untally">TAKE ONE BACK</button>' : ''}`,
    desk: '',
  }[s.zone];

  openSheet(`
    <p class="eyebrow">${name} · ${esc(line)}</p>
    <input class="edit" value="${esc(s.text)}" maxlength="40" aria-label="What the scrap says" enterkeyhint="done">
    <p class="meta">${meta.join(' · ')}</p>
    ${actions ? `<div class="actions">${actions}</div>` : ''}
    <p class="eyebrow">${s.zone === 'desk' ? 'STICK IT ON THE BOARD' : 'MOVE IT'}</p>
    <div class="swatches">${ZONES.map(z => `<button class="sw" type="button" style="--c: var(--${z})" data-act="move:${z}"
      aria-label="Move to ${ZONE_INFO[z][0].toLowerCase()}" title="${ZONE_INFO[z][0]}"${z === s.zone ? ' aria-current="true"' : ''}></button>`).join('')}</div>
    <button class="btn btn-ghost btn-small" type="button" data-act="toss">CRUMPLE IT</button>`,
  act => scrapAct(s, act), { tint: s.zone });

  const input = $('.edit', sheetDlg);
  input.addEventListener('input', () => {
    const text = input.value.trim();
    if (text) { s.text = text; save(); sheetDirty = true; }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') closeSheet(); });
}

function scrapAct(s, act) {
  if (act === 'lock') {
    closeSheet();
    if (state.lock?.id === s.id) showLock();
    else startLock(s.id);
  } else if (act === 'done') {
    closeSheet();
    markDone(s.id);
  } else if (act === 'delegate') {
    s.delegate = !s.delegate;
    save();
    sheetDirty = true;
    openScrap(s.id);
  } else if (act === 'start') {
    openHiding(s);
  } else if (act === 'tally') {
    s.tallies.push(Date.now());
    save();
    sheetDirty = false;
    closeSheet();
    render();
    land(s.id);
  } else if (act === 'untally') {
    const i = s.tallies.findLastIndex(isToday);
    if (i >= 0) s.tallies.splice(i, 1);
    save();
    sheetDirty = true;
    openScrap(s.id);
  } else if (act.startsWith('move:')) {
    sheetDirty = false;
    closeSheet();
    moveTo(s, act.slice(5));
  } else if (act === 'toss') {
    closeSheet();
    const el = scrapEl(s.id);
    if (el) crumple(ghostOf(el), () => toss(s.id));
    else toss(s.id);
  }
}

// Yellow: be honest about what you're avoiding.
function openHiding(s) {
  const g = state.scraps
    .filter(x => x.zone === 'green' && !x.doneAt)
    .sort((a, b) => (a.movedAt || a.createdAt) - (b.movedAt || b.createdAt))[0];

  if (g) {
    openSheet(`
      <h2 class="sheet-title">HiDiNG FROM SOMETHiNG?</h2>
      <p>“${esc(g.text)}” has been sitting in the green ${age(g.movedAt || g.createdAt)}.</p>
      <div class="actions col">
        <button class="btn btn-go" type="button" data-act="instead">OK, DO THAT INSTEAD</button>
        <button class="btn btn-blue" type="button" data-act="needed">THIS ACTUALLY HAS TO GET DONE</button>
        <button class="btn btn-ghost" type="button" data-act="anyway">DOiNG iT ANYWAY</button>
      </div>`,
    act => {
      closeSheet();
      if (act === 'instead') startLock(g.id);
      if (act === 'needed') moveTo(s, 'blue');
      if (act === 'anyway') callout(g.id);
    }, { cls: 'note-sheet' });
  } else {
    openSheet(`
      <h2 class="sheet-title">NOTHiNG iN THE GREEN?</h2>
      <p>What would you rather be making? Put that on the board first.</p>
      <div class="actions col">
        <button class="btn btn-go" type="button" data-act="write">WRiTE ONE</button>
        <button class="btn btn-ghost" type="button" data-act="anyway">DOiNG iT ANYWAY</button>
      </div>`,
    act => {
      closeSheet();
      if (act === 'write') $('#write-input').focus();
    }, { cls: 'note-sheet' });
  }
}

function openPile() {
  const done = state.scraps.filter(s => s.doneAt).sort((a, b) => b.doneAt - a.doneAt);
  let rows = '';
  let day = '';
  for (const s of done) {
    const label = dayLabel(s.doneAt);
    if (label !== day) { day = label; rows += `<li class="pile-day">${label}</li>`; }
    rows += `<li class="pile-row" style="--c: var(--${s.zone})"><span class="chip" aria-hidden="true"></span>
      <span class="pile-text">${esc(s.text)}</span>
      <button class="mini" type="button" data-act="back:${s.id}">PUT BACK</button>
      <button class="mini mini-x" type="button" data-act="toss:${s.id}" aria-label="Throw out ${esc(s.text)}">×</button></li>`;
  }
  openSheet(`
    <p class="eyebrow">THE PILE</p>
    <h2 class="sheet-title">${done.length ? `${done.length} thing${done.length === 1 ? '' : 's'} finished` : 'nothing finished yet'}</h2>
    ${done.length ? `<ul class="pile-list">${rows}</ul>` : '<p class="meta">Stamp something DONE and it lands here. This is the good stuff.</p>'}`,
  act => {
    const [verb, id] = act.split(':');
    const s = find(id);
    if (!s) return;
    if (verb === 'back') {
      [s.x, s.y] = randomSpot(s.zone);
      Object.assign(s, { doneAt: null, r: tilt() });
    } else if (verb === 'toss') {
      state.scraps = state.scraps.filter(x => x !== s);
    }
    save();
    render();
    openPile();
  });
}

function openHelp() {
  openSheet(`
    <p class="eyebrow">HOW iT WORKS</p>
    <ul class="help">
      <li><i></i><span>Write a scrap and hit <b>STICK IT</b>. It lands on your desk.</span></li>
      <li><i></i><span>Drag it onto the board. Where it goes is the whole point.</span></li>
      <li><i></i><span>Tap a scrap to see what you can do with it.</span></li>
      <li><i style="--c: var(--green)"></i><span><b>GREEN</b> is the work. Lock the door and make the thing.</span></li>
      <li><i style="--c: var(--blue)"></i><span><b>BLUE</b> is the storm. Batch it in a storm hour.</span></li>
      <li><i style="--c: var(--yellow)"></i><span><b>YELLOW</b> is procrastination maxing. Be honest about why you're doing it.</span></li>
      <li><i style="--c: var(--red)"></i><span><b>RED</b> is the sirens. Every time you give in, add a tally.</span></li>
      <li><i></i><span>Drop a scrap on <b>THE PILE</b> when it's done, or in the <b>BIN</b> to crumple it.</span></li>
      <li><i></i><span>Tap an empty spot in a square to zoom in on it.</span></li>
    </ul>`, null);
}

/* ---------- green: lock the door ---------- */

async function holdWake() {
  try { wake = await navigator.wakeLock?.request('screen'); } catch {}
}
function dropWake() {
  wake?.release?.().catch(() => {});
  wake = null;
}

function startLock(id) {
  if (state.lock) {
    const prev = find(state.lock.id);
    if (prev) prev.focusMs += Date.now() - state.lock.startedAt;
  }
  state.lock = { id, startedAt: Date.now() };
  save();
  buzz(30);
  showLock();
}

function showLock() {
  const s = find(state.lock?.id);
  if (!s || s.doneAt) { state.lock = null; save(); return; }
  takeover.className = 'takeover lock';
  takeover.innerHTML = `<div class="takeover-body">
    <p class="tag big">DOOR LOCKED</p>
    <div class="scrap hero" style="--r: -2deg"><div class="cut" style="clip-path: ${edge(s.id)}"><span class="ink">${esc(s.text)}</span></div></div>
    <p class="clock" id="lock-clock" role="timer" aria-label="Time behind the locked door"></p>
    <p class="scrawl">no calls. no email. no dillydallying.</p>
    <div class="actions">
      <button class="btn btn-go" type="button" data-act="finished">FiNiSHED iT</button>
      <button class="btn btn-ghost" type="button" data-act="unlock">UNLOCK THE DOOR</button>
    </div></div>`;
  onTakeoverAct = act => endLock(act === 'finished');
  if (!takeover.open) takeover.showModal();
  tick();
  holdWake();
}

function endLock(finished) {
  const s = find(state.lock?.id);
  if (s) s.focusMs += Date.now() - state.lock.startedAt;
  state.lock = null;
  save();
  dropWake();
  takeover.close();
  if (s && finished) markDone(s.id);
}

/* ---------- blue: storm hour ---------- */

const stormLeft = () => state.storm.startedAt + state.storm.minutes * 60000 - Date.now();

function openStorm() {
  takeover.className = 'takeover storm';
  onTakeoverAct = stormAct;
  renderStorm();
  if (!takeover.open) takeover.showModal();
}

function renderStorm() {
  const storm = state.storm;
  const blues = state.scraps.filter(s => s.zone === 'blue' && (!s.doneAt || storm?.done.includes(s.id)));

  if (!storm) {
    takeover.innerHTML = `<div class="takeover-body">
      <p class="tag big">STORM HOUR</p>
      <p class="scrawl">the stuff you don't want to do but have to. batch it. get thru it.</p>
      <div class="chips">${STORM_CHOICES.map(m => `<button class="chip-btn" type="button" data-act="min:${m}" aria-pressed="${m === stormMinutes}">${m} MiN</button>`).join('')}</div>
      <p class="scrawl">${blues.length ? `${blues.length} blue scrap${blues.length === 1 ? '' : 's'} waiting.` : 'nothing in the blue. lucky you.'}</p>
      <div class="actions">
        <button class="btn btn-blue" type="button" data-act="start">START THE STORM</button>
        <button class="btn btn-ghost" type="button" data-act="close">NOT NOW</button>
      </div></div>`;
    return;
  }

  const left = stormLeft();
  takeover.innerHTML = `<div class="takeover-body">
    <p class="tag big">STORM HOUR</p>
    <p class="clock" id="storm-clock" role="timer" aria-label="Time left in the storm">${clockHTML(clock(left + 999))}</p>
    ${left <= 0 ? '<p class="scrawl-head">STORM\'S OVER. GO MAKE SOMETHiNG.</p>' : ''}
    <ul class="checklist">${blues.map(s => `<li><label class="check">
      <input type="checkbox" data-id="${s.id}"${s.doneAt ? ' checked' : ''}><span class="box"></span><span class="txt">${esc(s.text)}</span>
      </label></li>`).join('') || '<li class="empty">nothing in the blue.</li>'}</ul>
    <div class="actions">
      <button class="btn btn-ghost" type="button" data-act="close">BACK TO THE BOARD</button>
      <button class="btn" type="button" data-act="end">END THE STORM</button>
    </div></div>`;
}

function stormAct(act) {
  if (act.startsWith('min:')) {
    stormMinutes = Number(act.slice(4));
    renderStorm();
  } else if (act === 'start') {
    state.storm = { startedAt: Date.now(), minutes: stormMinutes, done: [], over: false };
    save();
    buzz(30);
    renderStorm();
  } else if (act === 'end') {
    state.storm = null;
    save();
    takeover.close();
    tick();
  } else if (act === 'close') {
    takeover.close();
  }
}

takeover.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) onTakeoverAct?.(b.dataset.act);
});
takeover.addEventListener('change', e => {
  const s = find(e.target.dataset.id);
  if (!s || !state.storm) return;
  if (e.target.checked) {
    s.doneAt = Date.now();
    state.storm.done.push(s.id);
    buzz(15);
  } else {
    s.doneAt = null;
    state.storm.done = state.storm.done.filter(id => id !== s.id);
  }
  save();
  render();
});
// The door stays locked: Escape doesn't get you out, only the buttons do.
takeover.addEventListener('cancel', e => { if (state.lock) e.preventDefault(); });

/* ---------- clock tick ---------- */

function tick() {
  if (state.lock && takeover.open) {
    const c = $('#lock-clock');
    if (c) c.innerHTML = clockHTML(clock(Date.now() - state.lock.startedAt, true));
  }
  const btn = $('#storm-btn');
  if (!state.storm) {
    btn.textContent = 'STORM HOUR';
    return;
  }
  const left = stormLeft();
  btn.textContent = left > 0 ? `STORM ${clock(left + 999)}` : "STORM'S OVER";
  const c = $('#storm-clock');
  if (c) c.innerHTML = clockHTML(clock(left + 999));
  if (left <= 0 && !state.storm.over) {
    state.storm.over = true;
    save();
    buzz([200, 100, 200]);
    if (c) renderStorm();
  }
}

/* ---------- toast ---------- */

const canPopover = typeof toastEl.showPopover === 'function';
if (!canPopover) { toastEl.removeAttribute('popover'); toastEl.hidden = true; }
let toastTimer;

function toast(message, label, onClick) {
  const text = document.createElement('span');
  text.textContent = message;
  toastEl.replaceChildren(text);
  if (label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => { hideToast(); onClick(); };
    toastEl.append(b);
  }
  if (!canPopover) toastEl.hidden = false;
  else if (!toastEl.matches(':popover-open')) toastEl.showPopover();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  if (!canPopover) toastEl.hidden = true;
  else if (toastEl.matches(':popover-open')) toastEl.hidePopover();
}

/* ---------- the desk background ---------- */

function paintDesk() {
  const c = $('#desk');
  const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = rng(1209);

  g.fillStyle = '#583a22';
  g.fillRect(0, 0, w, h);

  // Worn patches and grime.
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, rad = 60 + r() * 260;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, r() < 0.4 ? 'rgba(170,115,60,.22)' : 'rgba(18,9,3,.32)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Wood grain.
  for (let y = -10; y < h + 10; y += 2.5) {
    g.strokeStyle = r() < 0.55 ? `rgba(28,14,5,${(r() * 0.22).toFixed(3)})` : `rgba(150,100,55,${(r() * 0.12).toFixed(3)})`;
    g.lineWidth = 0.6 + r() * 1.8;
    const phase = r() * 6.3, amp = 1 + r() * 5, freq = 0.0015 + r() * 0.004;
    g.beginPath();
    for (let x = 0; x <= w + 24; x += 24) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      if (x) g.lineTo(x, yy); else g.moveTo(x, yy);
    }
    g.stroke();
  }

  // Scratches.
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x = r() * w, y = r() * h, len = 10 + r() * 70, a = r() * Math.PI;
    g.strokeStyle = `rgba(225,195,150,${(0.06 + r() * 0.14).toFixed(3)})`;
    g.lineWidth = 0.5 + r();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }

  // Paint: mostly white and black, now and then a colour.
  const white = 'rgba(238,234,224,.88)', black = 'rgba(14,12,10,.85)';
  const colours = ['rgba(205,60,50,.75)', 'rgba(70,110,190,.7)', 'rgba(230,200,70,.7)'];
  const count = Math.round((w * h) / 9000);
  for (let i = 0; i < count; i++) {
    const roll = r();
    splat(g, r, r() * w, r() * h, roll < 0.62 ? white : roll < 0.88 ? black : colours[Math.floor(r() * colours.length)]);
  }

  // A few long white drips, like someone shook a brush.
  for (let i = 0; i < Math.max(3, w / 300); i++) {
    let x = r() * w, y = r() * h;
    g.strokeStyle = 'rgba(236,232,222,.7)';
    g.lineWidth = 0.8 + r() * 2.2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      const nx = x + (r() - 0.3) * 160, ny = y + (r() - 0.5) * 60;
      g.quadraticCurveTo(x + (r() - 0.5) * 80, y + (r() - 0.5) * 80, nx, ny);
      x = nx;
      y = ny;
    }
    g.stroke();
  }
}

function splat(g, r, x, y, colour) {
  const rad = 1 + r() ** 2 * 7;
  g.fillStyle = colour;
  g.beginPath();
  g.ellipse(x, y, rad, rad * (0.7 + r() * 0.5), r() * 3, 0, Math.PI * 2);
  g.fill();
  const drops = 3 + Math.floor(r() * 10);
  for (let i = 0; i < drops; i++) {
    const a = r() * Math.PI * 2, d = rad * (1.2 + r() * 3);
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rad * (0.08 + r() * 0.3), 0, Math.PI * 2);
    g.fill();
  }
  if (r() < 0.25) {
    g.strokeStyle = colour;
    g.lineWidth = rad * 0.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * rad * 8, y + (r() - 0.5) * rad * 8);
    g.stroke();
  }
}

/* ---------- wiring ---------- */

$('#write-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#write-input');
  const text = input.value.trim();
  if (!text) {
    input.classList.remove('nope');
    void input.offsetWidth;
    input.classList.add('nope');
    input.focus();
    return;
  }
  const s = newScrap(text, 'desk');
  state.scraps.push(s);
  save();
  render();
  land(s.id);
  input.value = '';
});

$('#grid').addEventListener('click', e => {
  if (e.target.closest('.scrap, button')) return;
  const quad = e.target.closest('.quad');
  if (quad) zoomTo(zoomed ? null : quad.dataset.zone);
});

$('#grid').addEventListener('transitionend', e => {
  if (e.target === e.currentTarget && !zoomed) $('#grid-view').classList.remove('zoomed');
});
$('#zoom-out').addEventListener('click', () => zoomTo(null));
$('#help-btn').addEventListener('click', openHelp);
$('#storm-btn').addEventListener('click', openStorm);
$('#pile-btn').addEventListener('click', openPile);
$('#bin').addEventListener('click', () => toast('Drag a scrap here to crumple it.'));

document.addEventListener('keydown', e => {
  if ($('dialog[open]')) return;
  const el = e.target.closest?.('[data-zone] > .scrap');
  if (el && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openScrap(el.dataset.id);
  } else if (e.key === 'Escape' && zoomed) {
    zoomTo(null);
  }
});

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    paintDesk();
    if (!drag) render();
    if (zoomed) zoomTo(zoomed);
  }, 150);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.lock) holdWake();
});

/* ---------- start ---------- */

state = load();
render();
paintDesk();
document.fonts?.ready.then(() => { if (!drag) render(); });
if (state.lock) showLock();
tick();
setInterval(tick, 1000);

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
