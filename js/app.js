// =====================================================================
//  Excel del Hotel — hoja de cálculo colaborativa en tiempo real
// =====================================================================
import { createStore, usingFirebase, getIn } from './store.js';
import {
  Calc, colName, keyOf, parseKey, display, shiftFormula, transposeFormula, adjustRefs, renameSheetRefs, parseDate, quoteSheet,
  formulaRefs, toEnglish, FUNCTION_LIST, FErr, compareValues, todaySerial, nowSerial, tokenize, fmtGeneral
} from './formulas.js';
import { buildUI, menu, closeMenu, dialog, FONTS, SIZES } from './ui.js';
import { extractStyles } from './xlsxstyles.js';

const DEF_W = 64, DEF_H = 20, HDR_H = 20, MIN_ROWS = 1000, MIN_COLS = 52;
const BASE_PT = 11;
const PALETTE = ['#e3008c', '#0078d4', '#8764b8', '#ca5010', '#038387', '#c239b3', '#498205', '#986f0b', '#d13438', '#4f6bed'];
const STD_COLORS = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
  '#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffd966', '#5b9bd5', '#70ad47'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
const lsGet = (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignorar */ } };

// ------------------------------------------------------------------ estado
const S = {
  book: getBook(),
  tree: { meta: {}, hojas: {}, celdas: {} },
  sid: null,
  sel: { ar: 0, ac: 0, fr: 0, fc: 0 },
  z: 1, editing: null, undo: [], redo: [], others: {}, clip: null,
  showF: false, grid: lsGet('xw-grid') !== '0',
  fillColor: '#ffff00', fontColor: '#c00000', painter: null, extraRows: 0, ready: false
};
let store = null, U = null, G = null, geomDirty = true, dataDirty = true, rendered = null, rafId = 0;
const extents = new Map();

// Carga perezosa de hojas: cada usuario descarga solo lo que ve
const loaded = new Set(), loadReq = new Map();
function ensureLoaded(sid) {
  if (!sid || !store) return Promise.resolve();
  let p = loadReq.get(sid);
  if (!p) {
    let res; p = new Promise(r => { res = r; }); p.res = res;
    loadReq.set(sid, p);
    store.watch(sid);
  }
  return p;
}
function onLoaded(sid) {
  loaded.add(sid);
  const p = loadReq.get(sid); if (p && p.res) p.res();
  calc.reset(); dataDirty = true; extents.delete(sid);
  if (sid === S.sid) { geomDirty = true; if (!S.editing) { U.smode.textContent = 'Listo'; scheduleFormulaBar(); } }
  schedule();
}
async function loadAll(why) {
  const pend = sortedSheets().map(([sid]) => sid).filter(sid => !loaded.has(sid));
  if (!pend.length) return;
  if (why) toast(why);
  await Promise.all(pend.map(ensureLoaded));
}

function getBook() {
  const h = new URLSearchParams(location.hash.slice(1)).get('libro');
  return h ? h.replace(/[^\w-]/g, '').slice(0, 40) || null : null;
}

// Libros del repositorio: se cargan solos en Firebase la primera vez que alguien los abre
const LIBROS = [
  { id: 'pedido-bodegas-2024', nombre: 'PEDIDO BODEGAS 2024', archivo: 'PEDIDO BODEGAS 2024.xlsx', baseId: '1lnxnsq2fi', icon: 'inventory_2', desc: 'Pedidos semanales de bodega, vencimientos, centros de costo' },
  { id: 'pedido-cocina-2024', nombre: 'PEDIDO DE COCINA 2024', archivo: 'PEDIDO DE COCINA 2024 - copia.xlsx', baseId: 'qccjcx9wor', icon: 'restaurant', desc: 'Pedidos diarios de cocina por proveedor' }
];
const libroById = id => LIBROS.find(l => l.id === id);

// Pantalla inicial: elegir a qué libro ingresar
function launcher() {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.className = 'modal hero launcher';
    const last = lsGet('xw-book');
    d.innerHTML = `<div class="mbox lbox">
      <div class="mhero"><img src="icons/icon-192.png" alt=""><div><b>Excel del Hotel</b><span>Hojas de cálculo compartidas en tiempo real</span></div></div>
      <label class="lname">Tu nombre<input class="min" id="lnombre" placeholder="Escribe tu nombre" value="${esc(lsGet('xw-nombre') || '')}"></label>
      <h3>¿A qué libro deseas ingresar?</h3>
      <div class="lcards">${LIBROS.map(l => `<button class="lcard${l.id === last ? ' last' : ''}" data-id="${l.id}">
        <span class="ms">${l.icon}</span><span class="lt"><b>${esc(l.nombre)}</b><small>${esc(l.desc)}</small></span>
        ${l.id === last ? '<em>Último abierto</em>' : ''}<span class="ms go">chevron_right</span></button>`).join('')}</div>
      <button class="lother">Abrir otro libro o crear uno nuevo…</button>
    </div>`;
    document.body.appendChild(d);
    const nameIn = d.querySelector('#lnombre');
    const done = id => {
      let n = nameIn.value.trim();
      if (!n) { nameIn.focus(); nameIn.classList.add('bad'); toast('Escribe tu nombre para continuar', 'warn'); return; }
      lsSet('xw-nombre', n); d.remove(); resolve(id);
    };
    d.querySelectorAll('.lcard').forEach(b => b.onclick = () => done(b.dataset.id));
    d.querySelector('.lother').onclick = async () => {
      if (!nameIn.value.trim()) return done(null);
      const v = (await dialog({ title: 'Abrir otro libro', text: 'Escribe el código de un libro existente, o un nombre nuevo para crear un libro en blanco:', input: '' }))?.trim();
      if (!v) return;
      const id = v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      if (!id) return;
      lsSet('xw-newname:' + id, v);
      done(id);
    };
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { const l = d.querySelector('.lcard.last') || d.querySelector('.lcard'); l.focus(); } });
    setTimeout(() => (nameIn.value ? d.querySelector('.lcard.last, .lcard') : nameIn).focus(), 50);
  });
}

// ------------------------------------------------------------------ modelo para la calculadora
const model = {
  raw: (sid, r, c) => { if (!loadReq.has(sid)) ensureLoaded(sid); const m = S.tree.celdas[sid]; if (!m) return undefined; const x = m[keyOf(r, c)]; return x ? x.v : undefined; },
  sheetIdByName(name) {
    const n = name.toLowerCase();
    for (const [id, h] of Object.entries(S.tree.hojas)) if ((h.nombre || '').toLowerCase() === n) return id;
    return null;
  },
  cellKeys: sid => Object.keys(S.tree.celdas[sid] || {}),
  extent(sid) {
    let e = extents.get(sid);
    if (!e) {
      e = { r: -1, c: -1 };
      for (const k in S.tree.celdas[sid] || {}) { const p = parseKey(k); if (p) { if (p.r > e.r) e.r = p.r; if (p.c > e.c) e.c = p.c; } }
      extents.set(sid, e);
    }
    return e;
  }
};
const calc = new Calc(model);

const cur = () => S.tree.hojas[S.sid] || { nombre: 'Hoja1', orden: 0 };
const cellsOf = sid => S.tree.celdas[sid] || {};
const cellAt = (r, c, sid = S.sid) => cellsOf(sid)[keyOf(r, c)];
const sortedSheets = () => Object.entries(S.tree.hojas).sort((a, b) => (a[1].orden ?? 0) - (b[1].orden ?? 0));
const rng = () => { const s = S.sel; return { r1: Math.min(s.ar, s.fr), r2: Math.max(s.ar, s.fr), c1: Math.min(s.ac, s.fc), c2: Math.max(s.ac, s.fc) }; };

// ================================================================== INICIO
init();
async function init() {
  U = buildUI(document.getElementById('app'));
  setupFavicon();
  setupPWA();
  bindUI();
  U.fillBar.style.background = S.fillColor;
  U.colorBar.style.background = S.fontColor;
  if (!S.grid) U.gw.classList.add('nogrid');

  if (!S.book) {
    S.book = await launcher();
    history.replaceState(null, '', '#libro=' + S.book);
  }
  lsSet('xw-book', S.book);
  window.addEventListener('hashchange', () => location.reload());
  const nombre = lsGet('xw-nombre') || 'Usuario ' + Math.floor(Math.random() * 900 + 100);
  const lb = libroById(S.book);
  if (lb) { U.bookName.textContent = lb.nombre; document.title = lb.nombre + ' - Excel'; }
  S.me = { nombre, color: PALETTE[Math.abs(hash(nombre + Math.random())) % PALETTE.length] };

  if (!usingFirebase()) {
    toast('Modo local: los datos se guardan en este navegador. Configura Firebase en js/firebase-config.js para trabajar entre varias computadoras.', 'warn', 9000);
  }
  try {
    store = await createStore(S.book, {
      onMeta: m => { S.tree.meta = m || {}; S.metaLoaded = true; updateTitle(); maybeUpgrade(); },
      onSheet: (sid, v) => {
        if (v) S.tree.hojas[sid] = v; else { delete S.tree.hojas[sid]; delete S.tree.celdas[sid]; extents.delete(sid); loaded.delete(sid); loadReq.delete(sid); }
        calc.reset(); dataDirty = true;
        if (sid === S.sid) { geomDirty = true; if (!v && S.ready) switchSheet(sortedSheets()[0]?.[0]); }
        scheduleTabs(); schedule();
      },
      onCell: (sid, k, v) => {
        const m = S.tree.celdas[sid] || (S.tree.celdas[sid] = {});
        if (v) m[k] = v; else delete m[k];
        extents.delete(sid); calc.reset(); dataDirty = true;
        if (sid === S.sid && G) { const p = parseKey(k); if (p && (p.r + 100 > G.nr || p.c + 10 > G.nc)) geomDirty = true; }
        if (!S.editing && sid === S.sid) scheduleFormulaBar();
        schedule();
      },
      onPresence: (id, v) => {
        const o = S.others[id];
        if (v) S.others[id] = { ...v, _t: !o || o.ar !== v.ar || o.ac !== v.ac || o.hoja !== v.hoja ? Date.now() : o._t };
        else delete S.others[id];
        renderUsers(); schedule(); setTimeout(schedule, 3200);
      },
      onReady: () => { S.ready = true; ensureSheet(); },
      onLoaded,
      onStatus: setCloud,
      onError: msg => toast(msg, 'err', 10000)
    });
  } catch (e) {
    console.error(e);
    setCloud({ mode: 'error' });
    if (!e || !e.code) toast('No se pudo cargar Firebase. Revisa tu conexión a internet y recarga la página.', 'err', 12000);
    return;
  }
  U.ed.focus();
}

function ensureSheet() {
  const list = sortedSheets();
  const lb = libroById(S.book);
  if (!list.length && lb) { seedBook(lb); return; }
  if (!list.length) {
    store.write({ 'hojas/h1': { nombre: 'Hoja1', orden: 0 }, 'meta/nombre': S.tree.meta.nombre || 'Libro1' });
    switchSheet('h1');
    return;
  }
  const hp = new URLSearchParams(location.hash.slice(1)), hoja = hp.get('hoja'), celda = (hp.get('celda') || '').toUpperCase();
  const saved = lsGet('xw-sheet:' + S.book);
  switchSheet(S.tree.hojas[hoja] ? hoja : S.tree.hojas[saved] ? saved : list[0][0]);
  if (hoja && celda) {
    history.replaceState(null, '', '#libro=' + S.book);
    const m = /^([A-Z]+\d+)(?::([A-Z]+\d+))?$/.exec(celda);
    if (m) { const a = parseKey(m[1]), b = parseKey(m[2] || m[1]); S.pendingScroll = null; S.extraRows = Math.max(a.r, b.r) + 200; geom(); select(a.r, a.c, b.r, b.c); }
  }
  maybeUpgrade();
}

function switchSheet(sid) {
  if (!sid) return;
  if (S.editing) commit(0, 0);
  if (S.sid && S.sid !== sid) savePos(true);
  S.sid = sid; lsSet('xw-sheet:' + S.book, sid);
  if (!loaded.has(sid)) U.smode.textContent = 'Cargando hoja…';
  ensureLoaded(sid);
  S.extraRows = 0; geomDirty = true; dataDirty = true;
  // vuelve a la celda y al desplazamiento donde lo dejaste
  let pos = null; try { pos = JSON.parse(lsGet(`xw-pos:${S.book}:${sid}`) || 'null'); } catch { pos = null; }
  S.sel = pos && pos.ar != null ? { ar: pos.ar, ac: pos.ac, fr: pos.fr ?? pos.ar, fc: pos.fc ?? pos.ac } : { ar: 0, ac: 0, fr: 0, fc: 0 };
  S.extraRows = pos ? Math.max(S.sel.ar, S.sel.fr) + 200 : 0;
  S.pendingScroll = pos ? { t: pos.t || 0, l: pos.l || 0 } : null;
  U.gw.scrollTop = 0; U.gw.scrollLeft = 0;
  renderTabs(); onSel(); schedule();
}
let posT = 0;
function savePos(now) {
  clearTimeout(posT);
  const go = () => {
    if (!S.sid || S.pendingScroll) return;
    lsSet(`xw-pos:${S.book}:${S.sid}`, JSON.stringify({ ...S.sel, t: Math.round(U.gw.scrollTop / S.z), l: Math.round(U.gw.scrollLeft / S.z) }));
  };
  if (now) go(); else posT = setTimeout(go, 400);
}

// ================================================================== GEOMETRÍA
function geom() {
  const sh = cur(), z = S.z, e = model.extent(S.sid);
  const nr = Math.max(MIN_ROWS, e.r + 101, S.extraRows), nc = Math.max(MIN_COLS, e.c + 11);
  const an = sh.anchos || {}, al = sh.altos || {};
  const colX = new Float64Array(nc + 1), rowY = new Float64Array(nr + 1);
  for (let c = 0; c < nc; c++) colX[c + 1] = colX[c] + Math.round((an['c' + c] ?? DEF_W) * z);
  for (let r = 0; r < nr; r++) rowY[r + 1] = rowY[r] + Math.round((al['r' + r] ?? DEF_H) * z);
  const rhw = Math.round(Math.max(34, String(nr).length * 8 + 12) * z), hh = Math.round(HDR_H * z);
  G = { nr, nc, colX, rowY, rhw, hh };
  U.gc.style.width = rhw + colX[nc] + 'px';
  U.gc.style.height = hh + rowY[nr] + 'px';
  U.chdr.style.height = hh + 'px';
  U.corner.style.width = rhw + 'px';
  U.rhdr.style.width = rhw + 'px';
  U.rhdr.style.height = rowY[nr] + 'px';
  U.gc.style.setProperty('--z', z);
  geomDirty = false; rendered = null;
}
function bsearch(arr, n, v) { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; } return lo; }
const colAt = x => bsearch(G.colX, G.nc, x);
const rowAt = y => bsearch(G.rowY, G.nr, y);
const cellRect = (r1, c1, r2 = r1, c2 = c1) => ({
  x: G.rhw + G.colX[c1], y: G.hh + G.rowY[r1],
  w: G.colX[Math.min(c2, G.nc - 1) + 1] - G.colX[c1], h: G.rowY[Math.min(r2, G.nr - 1) + 1] - G.rowY[r1]
});

// ================================================================== RENDER
function schedule() { if (!rafId) rafId = requestAnimationFrame(render); }
let ctx2d = null;
function measure(text, font) {
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
  ctx2d.font = font; return ctx2d.measureText(text).width;
}
const fontCss = (s, z) => `${s.i ? 'italic ' : ''}${s.b ? 'bold ' : ''}${((s.fs || BASE_PT) * 4 / 3 * z).toFixed(1)}px ${s.ff ? `"${s.ff}",` : ''}"Aptos Narrow",Calibri,Carlito,"Segoe UI",Arial,sans-serif`;

function render() {
  rafId = 0;
  if (!S.sid) return;
  if (geomDirty || !G) geom();
  if (S.pendingScroll && loaded.has(S.sid)) {
    U.gw.scrollTop = S.pendingScroll.t * S.z; U.gw.scrollLeft = S.pendingScroll.l * S.z;
    S.pendingScroll = null; rendered = null;
  }
  const gw = U.gw, H = gw.clientHeight, W = gw.clientWidth, st = gw.scrollTop, sl = gw.scrollLeft;
  const vr0 = rowAt(st), vr1 = rowAt(st + H - G.hh), vc0 = colAt(sl), vc1 = colAt(sl + W - G.rhw);
  if (vr1 > G.nr - 60) { S.extraRows = G.nr + 500; geom(); }
  const need = !rendered || dataDirty || vr0 < rendered.r0 || vr1 > rendered.r1 || vc0 < rendered.c0 || vc1 > rendered.c1;
  if (need) {
    const r0 = Math.max(0, vr0 - 8), r1 = Math.min(G.nr - 1, vr1 + 12), c0 = Math.max(0, vc0 - 3), c1 = Math.min(G.nc - 1, vc1 + 4);
    renderCells(r0, r1, c0, c1);
    rendered = { r0, r1, c0, c1 }; dataDirty = false;
  }
  renderHeaders(vr0, Math.min(G.nr - 1, vr1 + 1), vc0, Math.min(G.nc - 1, vc1 + 1));
  renderOverlays();
  if (S.editing) placeEditor();
}

function renderCells(r0, r1, c0, c1) {
  const cells = cellsOf(S.sid), z = S.z, out = [];
  const { colX, rowY, rhw, hh } = G;
  for (let r = r0; r <= r1; r++) {
    const top = hh + rowY[r], h = rowY[r + 1] - rowY[r];
    let coverTo = -1;
    for (let c = c0; c <= c1; c++) {
      const left = rhw + colX[c], w = colX[c + 1] - colX[c];
      const cell = cells[keyOf(r, c)];
      const cov = c < coverTo ? ' cov' : '';
      if (!cell) { out.push(`<div class="c${cov}" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px"></div>`); continue; }
      const s = cell.s || {};
      const v = calc.value(S.sid, r, c);
      const d = S.showF && cell.v ? { t: cell.v, al: 'l' } : display(v, s);
      const al = s.a || d.al;
      let width = w, extra = '';
      if (d.t && !s.w && al === 'l' && typeof v === 'string' && !S.showF) {
        const tw = measure(d.t, fontCss(s, z)) + 6 * z;
        if (tw > w) {
          let cc = c + 1, ww = w;
          while (ww < tw && cc < G.nc && cc <= c1 + 12) {
            const n = cells[keyOf(r, cc)];
            if (n && n.v != null && n.v !== '') break;
            ww += colX[cc + 1] - colX[cc]; cc++;
          }
          if (cc > c + 1) { width = ww; coverTo = cc - 1; extra = ' ov'; }
        }
      }
      let st = `left:${left}px;top:${top}px;width:${width}px;height:${h}px;`;
      if (s.b) st += 'font-weight:700;';
      if (s.i) st += 'font-style:italic;';
      if (s.u) st += 'text-decoration:underline;';
      if (s.c) st += `color:${s.c};`;
      if (d.err) st += 'color:#c00000;';
      if (s.f) st += `background:${s.f};border-color:${s.f === '#ffffff' ? '' : s.f};`;
      const ba = s.bd === 'a', bt = s.bt || (ba ? 1 : 0), bb = s.bb || (ba || s.bd === 'b' ? 1 : 0), bl = s.bl || (ba ? 1 : 0), br = s.br || (ba ? 1 : 0);
      if (br) st += `border-right:${br}px solid #000;`;
      if (bb) st += `border-bottom:${bb}px solid #000;`;
      if (bl || bt) st += `box-shadow:${[bl ? `-${bl}px 0 0 #000` : '', bt ? `0 -${bt}px 0 #000` : ''].filter(Boolean).join(',')};`;
      if (s.fs) st += `font-size:${(s.fs * 4 / 3 * z).toFixed(1)}px;`;
      if (s.ff) st += `font-family:'${String(s.ff).replace(/['"<>;]/g, '')}',var(--cellfont);`;
      st += `justify-content:${al === 'r' ? 'flex-end' : al === 'c' ? 'center' : 'flex-start'};text-align:${al === 'r' ? 'right' : al === 'c' ? 'center' : 'left'};`;
      if (s.va) st += `align-items:${s.va === 't' ? 'flex-start' : s.va === 'm' ? 'center' : 'flex-end'};`;
      let cls = 'c' + extra + cov;
      if (s.w) cls += ' wr';
      if (s.nt) cls += ' nt';
      out.push(`<div class="${cls}" style="${st}"${s.nt ? ` title="${esc(s.nt)}"` : ''}>${esc(d.t)}</div>`);
    }
  }
  U.cells.innerHTML = out.join('');
}

function renderHeaders(r0, r1, c0, c1) {
  const R = rng(), { colX, rowY, rhw, hh } = G;
  const fullCol = R.r1 === 0 && R.r2 >= G.nr - 1, fullRow = R.c1 === 0 && R.c2 >= G.nc - 1;
  let h = '';
  for (let c = c0; c <= c1; c++) {
    const on = c >= R.c1 && c <= R.c2;
    h += `<div class="ch${on ? (fullCol ? ' hf' : ' hs') : ''}" style="left:${rhw + colX[c]}px;width:${colX[c + 1] - colX[c]}px;height:${hh}px">${colName(c)}</div>`;
  }
  U.colheads.innerHTML = h;
  h = '';
  for (let r = r0; r <= r1; r++) {
    const on = r >= R.r1 && r <= R.r2;
    h += `<div class="rh${on ? (fullRow ? ' hf' : ' hs') : ''}" style="top:${rowY[r]}px;height:${rowY[r + 1] - rowY[r]}px;width:${rhw}px">${r + 1}</div>`;
  }
  U.rhdr.innerHTML = h;
}

function renderOverlays() {
  const R = rng(), z = S.z;
  const a = cellRect(R.r1, R.c1, R.r2, R.c2), ac = cellRect(S.sel.ar, S.sel.ac);
  let h = '';
  const multi = R.r1 !== R.r2 || R.c1 !== R.c2;
  if (multi) {
    const ox = ac.x - a.x, oy = ac.y - a.y;
    const clip = `polygon(evenodd,0 0,${a.w}px 0,${a.w}px ${a.h}px,0 ${a.h}px,0 0,${ox}px ${oy}px,${ox + ac.w}px ${oy}px,${ox + ac.w}px ${oy + ac.h}px,${ox}px ${oy + ac.h}px,${ox}px ${oy}px)`;
    h += `<div class="seltint" style="left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px;clip-path:${clip}"></div>`;
  }
  if (S.clip && S.clip.sid === S.sid) {
    const k = cellRect(S.clip.r1, S.clip.c1, S.clip.r2, S.clip.c2);
    h += `<div class="ants" style="left:${k.x - 1}px;top:${k.y - 1}px;width:${k.w + 1}px;height:${k.h + 1}px"></div>`;
  }
  if (S.editing && S.editing.sid === S.sid) {
    formulaRefs(U.ed.value).forEach((f, i) => {
      if (f.sheet && model.sheetIdByName(f.sheet) !== S.sid) return;
      const k = cellRect(f.r1, f.c1, Math.min(f.r2, G.nr - 1), f.c2), col = PALETTE[i % PALETTE.length];
      h += `<div class="fref" style="left:${k.x - 1}px;top:${k.y - 1}px;width:${k.w + 1}px;height:${k.h + 1}px;border-color:${col};background:${col}18"></div>`;
    });
  }
  for (const o of Object.values(S.others)) {
    if (o.hoja !== S.sid || o.ar == null) continue;
    const k = cellRect(o.ar, o.ac);
    const lbl = Date.now() - (o._t || 0) < 3000 ? `<span style="background:${o.color}">${esc(o.nombre)}</span>` : '';
    h += `<div class="peer" style="left:${k.x - 1}px;top:${k.y - 1}px;width:${k.w + 1}px;height:${k.h + 1}px;border-color:${o.color}" title="${esc(o.nombre)}">${lbl}</div>`;
  }
  if (!S.editing) h += `<div class="selbox" style="left:${a.x - 1}px;top:${a.y - 1}px;width:${a.w + 1}px;height:${a.h + 1}px"></div>`;
  if (!S.editing) h += `<div class="fillh" data-fill="1" style="left:${a.x + a.w - 4}px;top:${a.y + a.h - 4}px"></div>`;
  if (S.fillPrev) { const k = S.fillPrev; const q = cellRect(k.r1, k.c1, k.r2, k.c2); h += `<div class="fillprev" style="left:${q.x - 1}px;top:${q.y - 1}px;width:${q.w + 1}px;height:${q.h + 1}px"></div>`; }
  U.ovl.innerHTML = h;
  if (!S.editing) placeEditor();
  void z;
}

// ================================================================== SELECCIÓN
function select(r, c, fr = r, fc = c, scroll = true) {
  if (!G) return;
  const cl = (v, n) => Math.max(0, Math.min(n - 1, v));
  S.sel = { ar: cl(r, G.nr), ac: cl(c, G.nc), fr: cl(fr, G.nr), fc: cl(fc, G.nc) };
  if (scroll) ensureVisible(S.sel.fr, S.sel.fc);
  onSel();
}
let presT = 0;
function onSel() {
  const R = rng();
  U.namebox.value = (R.r1 === R.r2 && R.c1 === R.c2) ? keyOf(S.sel.ar, S.sel.ac) : `${keyOf(R.r1, R.c1)}:${keyOf(R.r2, R.c2)}`;
  if (!S.editing) U.fx.value = cellAt(S.sel.ar, S.sel.ac)?.v ?? '';
  refreshRibbon(); updateStats(); schedule(); savePos();
  clearTimeout(presT);
  presT = setTimeout(() => store && store.presence({ nombre: S.me.nombre, color: S.me.color, hoja: S.sid, ar: S.sel.ar, ac: S.sel.ac }), 400);
}
let fbT = 0;
function scheduleFormulaBar() { clearTimeout(fbT); fbT = setTimeout(() => { if (!S.editing) { U.fx.value = cellAt(S.sel.ar, S.sel.ac)?.v ?? ''; updateStats(); } }, 50); }

function ensureVisible(r, c) {
  if (!G) return;
  const gw = U.gw, k = cellRect(r, c);
  const vw = gw.clientWidth, vh = gw.clientHeight;
  if (k.y - G.hh < gw.scrollTop) gw.scrollTop = k.y - G.hh;
  else if (k.y + k.h > gw.scrollTop + vh) gw.scrollTop = k.y + k.h - vh;
  if (k.x - G.rhw < gw.scrollLeft) gw.scrollLeft = k.x - G.rhw;
  else if (k.x + k.w > gw.scrollLeft + vw) gw.scrollLeft = Math.min(k.x - G.rhw, k.x + k.w - vw);
}
const filled = (r, c) => { const x = cellAt(r, c); return !!(x && x.v != null && x.v !== ''); };
function edge(r, c, dr, dc) {
  const inb = (rr, cc) => rr >= 0 && cc >= 0 && rr < G.nr && cc < G.nc;
  if (!inb(r + dr, c + dc)) return [r, c];
  if (filled(r, c) && filled(r + dr, c + dc)) {
    while (inb(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; }
    return [r, c];
  }
  r += dr; c += dc;
  const e = model.extent(S.sid);
  while (inb(r + dr, c + dc) && !filled(r, c)) {
    if ((dr > 0 && r > e.r) || (dc > 0 && c > e.c)) return [dr ? G.nr - 1 : r, dc ? G.nc - 1 : c];
    r += dr; c += dc;
  }
  return [r, c];
}
function move(dr, dc, extend = false, jump = false) {
  const s = S.sel;
  let r = extend ? s.fr : s.ar, c = extend ? s.fc : s.ac;
  if (jump) [r, c] = edge(r, c, dr, dc); else { r += dr; c += dc; }
  if (extend) select(s.ar, s.ac, r, c); else select(r, c);
}
function updateStats() {
  const R = rng();
  if (R.r1 === R.r2 && R.c1 === R.c2) { U.stats.textContent = ''; return; }
  let n = 0, cnt = 0, sum = 0;
  calc.each({ sid: S.sid, ...R }, v => { cnt++; if (typeof v === 'number') { n++; sum += v; } });
  U.stats.textContent = cnt < 2 ? '' : n ? `Promedio: ${fmtGeneral(+(sum / n).toFixed(10))}    Recuento: ${cnt}    Suma: ${fmtGeneral(+sum.toFixed(10))}` : `Recuento: ${cnt}`;
}

// ================================================================== EDICIÓN
function placeEditor() {
  if (!G) return;
  const ed = U.ed, k = cellRect(S.sel.ar, S.sel.ac);
  ed.style.left = k.x + 'px'; ed.style.top = k.y + 'px';
  if (!S.editing) { ed.style.width = k.w + 'px'; ed.style.height = k.h + 'px'; return; }
  const s = cellAt(S.editing.r, S.editing.c)?.s || {};
  ed.style.font = fontCss(s, S.z);
  ed.style.fontWeight = s.b ? 700 : 400;
  ed.style.minWidth = k.w + 1 + 'px'; ed.style.minHeight = k.h + 1 + 'px';
  ed.style.width = '0px'; ed.style.height = '0px';
  ed.style.width = Math.min(Math.max(k.w + 1, ed.scrollWidth + 8), 900) + 'px';
  ed.style.height = Math.max(k.h + 1, ed.scrollHeight) + 'px';
}
function startEdit(text, mode = 'enter', src = 'cell') {
  if (S.editing) return;
  const { ar: r, ac: c } = S.sel;
  const raw = cellAt(r, c)?.v ?? '';
  S.editing = { sid: S.sid, r, c, mode, orig: raw };
  const ed = U.ed;
  ed.classList.remove('idle');
  ed.value = text == null ? raw : text;
  U.fx.value = ed.value;
  U.smode.textContent = mode === 'enter' ? 'Introducir' : 'Modificar';
  placeEditor();
  if (src === 'cell') { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
  schedule();
}
function stopEdit() {
  S.editing = null; S.point = null;
  U.ed.classList.add('idle'); U.ed.value = ''; U.ed.style.width = ''; U.ed.style.height = '';
  U.ed.style.minWidth = ''; U.ed.style.minHeight = '';
  U.smode.textContent = 'Listo';
}
function commit(dr = 0, dc = 0) {
  const e = S.editing; if (!e) return;
  const val = U.ed.value;
  stopEdit();
  if (val !== e.orig) setInput(e.sid, e.r, e.c, val);
  if (e.sid !== S.sid) switchSheet(e.sid);
  if (dr || dc) move(dr, dc); else onSel();
  U.ed.focus({ preventScroll: true });
}
function cancel() { if (!S.editing) return; stopEdit(); onSel(); U.ed.focus({ preventScroll: true }); }

function normalizeFormula(v) {
  let depth = 0, inStr = false;
  for (const ch of v) { if (ch === '"') inStr = !inStr; else if (!inStr) { if (ch === '(') depth++; else if (ch === ')') depth--; } }
  if (depth > 0 && !inStr) v += ')'.repeat(depth);
  try {
    const toks = tokenize(v.slice(1)); let out = v.slice(1);
    for (let i = toks.length - 1; i >= 0; i--) {
      const t = toks[i];
      if (t.k === 'id' || t.k === 'ref') out = out.slice(0, t.p) + (t.k === 'id' ? t.v : t.text.slice(0, t.text.length - t.ref.length) + t.ref.toUpperCase()) + out.slice(t.e);
    }
    return '=' + out;
  } catch { return v; }
}
function normalizeInput(text, style) {
  let v = text; const s = { ...(style || {}) };
  if (v.startsWith('=') && v.length > 1) return { v: normalizeFormula(v), s };
  const t = v.trim();
  if (/^[-+]?\d+(\.\d+)?%$/.test(t)) { v = String(parseFloat(t) / 100); if (!s.nf) s.nf = 'pct'; }
  else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t) && parseDate(t) !== null) { v = String(parseDate(t)); if (!s.nf) s.nf = 'date'; }
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) { v = t.replace(/,/g, ''); if (!s.nf) s.nf = 'num'; }
  else if (/^(S\/\.?|\$|US\$)\s?-?[\d,]+(\.\d+)?$/i.test(t)) { if (!s.nf) s.nf = /\$/.test(t) ? 'usd' : 'cur'; v = t.replace(/^(S\/\.?|\$|US\$)\s?/i, '').replace(/,/g, ''); }
  return { v, s };
}
function cellObj(v, s) {
  const st = {};
  for (const [k, x] of Object.entries(s || {})) if (x !== undefined && x !== null && x !== false && x !== '') st[k] = x;
  const hasS = Object.keys(st).length > 0;
  if ((v == null || v === '') && !hasS) return null;
  const o = {};
  if (v != null && v !== '') o.v = String(v);
  if (hasS) o.s = st;
  return o;
}
function setInput(sid, r, c, text) {
  const old = cellsOf(sid)[keyOf(r, c)];
  const { v, s } = normalizeInput(text, old?.s);
  write({ [`celdas/${sid}/${keyOf(r, c)}`]: cellObj(v, s) });
}

// ================================================================== ESCRITURA + DESHACER
function write(updates, record = true) {
  if (!store) return Promise.resolve();
  if (record) {
    const before = {};
    for (const p of Object.keys(updates)) before[p] = clone(getIn(S.tree, p));
    S.undo.push({ before, after: clone(updates), sid: S.sid, sel: { ...S.sel } });
    if (S.undo.length > 300) S.undo.shift();
    S.redo = [];
  }
  return store.write(updates);
}
function undo() {
  const e = S.undo.pop(); if (!e) return toast('No hay nada que deshacer');
  S.redo.push(e); store.write(e.before);
  if (e.sid !== S.sid && S.tree.hojas[e.sid]) switchSheet(e.sid);
  select(e.sel.ar, e.sel.ac, e.sel.fr, e.sel.fc);
}
function redo() {
  const e = S.redo.pop(); if (!e) return toast('No hay nada que rehacer');
  S.undo.push(e); store.write(e.after);
  if (e.sid !== S.sid && S.tree.hojas[e.sid]) switchSheet(e.sid);
  select(e.sel.ar, e.sel.ac, e.sel.fr, e.sel.fc);
}

// rango acotado al área usada (para no escribir miles de celdas vacías)
function boundedSel() {
  const R = rng(), e = model.extent(S.sid);
  if ((R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1) > 20000) { R.r2 = Math.min(R.r2, Math.max(e.r, R.r1)); R.c2 = Math.min(R.c2, Math.max(e.c, R.c1)); }
  return R;
}
function styleSel(fn) {
  const R = boundedSel(), cells = cellsOf(S.sid), upd = {};
  for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
    const k = keyOf(r, c), old = cells[k];
    upd[`celdas/${S.sid}/${k}`] = cellObj(old?.v, fn({ ...(old?.s || {}) }, old));
  }
  write(upd);
}
const activeStyle = () => cellAt(S.sel.ar, S.sel.ac)?.s || {};
// Bordes estilo Excel: por lado, todos, externos o grueso de cuadro
function borderSel(kind) {
  const R = boundedSel(), cells = cellsOf(S.sid), upd = {};
  for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
    const k = keyOf(r, c), old = cells[k], s = { ...(old?.s || {}) };
    if (s.bd === 'a') { s.bt = s.bb = s.bl = s.br = 1; }
    else if (s.bd === 'b') s.bb = 1;
    delete s.bd;
    const top = r === R.r1, bot = r === R.r2, lef = c === R.c1, rig = c === R.c2;
    if (kind === 'none') { delete s.bt; delete s.bb; delete s.bl; delete s.br; }
    else if (kind === 'all') { s.bt = s.bb = s.bl = s.br = 1; }
    else if (kind === 'out' || kind === 'thick') { const w = kind === 'thick' ? 2 : 1; if (top) s.bt = w; if (bot) s.bb = w; if (lef) s.bl = w; if (rig) s.br = w; }
    else if (kind === 'b' && bot) s.bb = 1; else if (kind === 't' && top) s.bt = 1;
    else if (kind === 'l' && lef) s.bl = 1; else if (kind === 'r' && rig) s.br = 1;
    if (s.bt === 1 && s.bb === 1 && s.bl === 1 && s.br === 1) { delete s.bt; delete s.bb; delete s.bl; delete s.br; s.bd = 'a'; }
    upd[`celdas/${S.sid}/${k}`] = cellObj(old?.v, s);
  }
  write(upd);
}
function clearSel(what) {
  const R = boundedSel(), cells = cellsOf(S.sid), upd = {};
  for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
    const k = keyOf(r, c), old = cells[k]; if (!old) continue;
    upd[`celdas/${S.sid}/${k}`] = what === 'all' ? null : what === 'fmt' ? cellObj(old.v, {}) : cellObj('', old.s);
  }
  if (Object.keys(upd).length) write(upd);
}

// ================================================================== PORTAPAPELES
function selectionMatrix(R) {
  const cells = cellsOf(S.sid), m = [];
  for (let r = R.r1; r <= R.r2; r++) { const row = []; for (let c = R.c1; c <= R.c2; c++) row.push(clone(cells[keyOf(r, c)]) || null); m.push(row); }
  return m;
}
function tsvOf(R) {
  const lines = [];
  for (let r = R.r1; r <= R.r2; r++) {
    const row = [];
    for (let c = R.c1; c <= R.c2; c++) {
      const t = display(calc.value(S.sid, r, c), cellAt(r, c)?.s).t;
      row.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
    }
    lines.push(row.join('\t'));
  }
  return lines.join('\n');
}
function doCopy(cut, ev) {
  const R = boundedSel();
  const text = tsvOf(R);
  S.clip = { sid: S.sid, ...R, m: selectionMatrix(R), text, cut };
  if (ev) { ev.clipboardData.setData('text/plain', text); ev.preventDefault(); }
  else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  schedule();
}
function parseTSV(t) {
  const rows = []; let row = [], f = '', q = false;
  t = t.replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"' && f === '') q = true;
    else if (ch === '\t') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
// Tabla copiada desde un correo (Gmail, Outlook), una web o Word: llega como HTML
function htmlRows(html) {
  if (!html || !/<table/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table'); if (!table) return null;
  const rows = [];
  const cellText = td => {
    const c = td.cloneNode(true);
    c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    c.querySelectorAll('p,div,li').forEach(b => b.append('\n'));
    c.querySelectorAll('style,script').forEach(b => b.remove());
    return c.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
  };
  for (const tr of table.querySelectorAll('tr')) {
    if (tr.closest('table') !== table) continue; // ignora tablas anidadas
    const row = [];
    for (const td of tr.children) {
      if (!/^(TD|TH)$/.test(td.tagName)) continue;
      const st = (td.getAttribute('style') || '') + ';' + [...td.querySelectorAll('[style]')].map(x => x.getAttribute('style')).join(';');
      const bold = td.tagName === 'TH' || !!td.querySelector('b,strong') || /font-weight:\s*(bold|[6-9]00)/i.test(st);
      row.push({ t: cellText(td), b: bold });
      for (let k = 1; k < (+td.getAttribute('colspan') || 1); k++) row.push({ t: '' });
    }
    if (row.length) rows.push(row);
  }
  return rows.length ? rows : null;
}
// Valor calculado como texto para "Pegar valores"
function valueRaw(v) {
  if (v == null) return '';
  if (v instanceof FErr) return v.code;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'number') return String(v);
  return /^[=']/.test(v) || /^[-+]?\d/.test(v) ? "'" + v : v;
}
// Modos de pegado como en Excel: all (todo), values, formulas, formats, transpose, link
function doPaste(text, html, mode = 'all') {
  const R = rng(), upd = {}, cells = cellsOf(S.sid);
  const norm = s => (s || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const clip = S.clip;
  if (clip && (text == null || norm(text) === norm(clip.text))) {
    const T = mode === 'transpose';
    const h = T ? clip.m[0].length : clip.m.length, w = T ? clip.m.length : clip.m[0].length;
    const th = (R.r2 - R.r1 + 1) % h === 0 ? R.r2 - R.r1 + 1 : h, tw = (R.c2 - R.c1 + 1) % w === 0 ? R.c2 - R.c1 + 1 : w;
    const move = clip.cut && mode === 'all';
    if (move) for (let r = clip.r1; r <= clip.r2; r++) for (let c = clip.c1; c <= clip.c2; c++) upd[`celdas/${clip.sid}/${keyOf(r, c)}`] = null;
    const srcSheet = S.tree.hojas[clip.sid]?.nombre || '';
    for (let i = 0; i < th; i++) for (let j = 0; j < tw; j++) {
      const si = T ? j % w : i % h, sj = T ? i % h : j % w;
      const src = clip.m[si][sj], r = R.r1 + i, c = R.c1 + j, sr = clip.r1 + si, sc = clip.c1 + sj;
      const k = keyOf(r, c), old = cells[k];
      let v = src?.v, s = src?.s;
      if (v && !move && v[0] === '=') v = T ? transposeFormula(v, sr, sc, r, c) : shiftFormula(v, r - sr, c - sc);
      if (mode === 'values') { v = valueRaw(calc.value(clip.sid, sr, sc)); s = old?.s; }
      else if (mode === 'formulas') s = old?.s;
      else if (mode === 'formats') { v = old?.v; s = src?.s; }
      else if (mode === 'link') { v = '=' + (clip.sid !== S.sid ? quoteSheet(srcSheet) + '!' : '') + keyOf(sr, sc); s = old?.s; }
      const o = cellObj(v, s);
      upd[`celdas/${S.sid}/${k}`] = o;
      if (mode !== 'all' && !src && old) upd[`celdas/${S.sid}/${k}`] = mode === 'formats' ? cellObj(old.v, null) : cellObj(v, old.s);
    }
    if (move) S.clip = null;
    write(upd);
    select(R.r1, R.c1, R.r1 + th - 1, R.c1 + tw - 1, false);
    return;
  }
  if (mode === 'formats' || mode === 'link') return toast('Esa opción de pegado solo está disponible para celdas copiadas de esta hoja de cálculo.');
  const hrows = htmlRows(html);
  let rows = hrows || parseTSV(text || '').map(r => r.map(t => ({ t })));
  if (!rows.length) return;
  if (mode === 'transpose') { const n = Math.max(...rows.map(r => r.length)); rows = Array.from({ length: n }, (_, j) => rows.map(r => r[j] || { t: '' })); }
  rows.forEach((row, i) => row.forEach((x, j) => {
    const k = keyOf(R.r1 + i, R.c1 + j), old = cells[k];
    const clean = String(x.t ?? '').replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();
    const { v, s } = normalizeInput(clean, old?.s);
    if (x.b && mode === 'all') s.b = 1;
    if (clean.includes('\n')) s.w = 1;
    upd[`celdas/${S.sid}/${k}`] = cellObj(v, s);
  }));
  write(upd);
  select(R.r1, R.c1, R.r1 + rows.length - 1, R.c1 + Math.max(...rows.map(r => r.length)) - 1, false);
}
// Pegar desde el menú (clic derecho o cinta): lee el portapapeles del sistema si el navegador lo permite
async function pasteMode(mode = 'all') {
  let text = null, html = null;
  try {
    if (navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      }
    } else text = await navigator.clipboard.readText();
  } catch { /* sin permiso: usa lo copiado en esta página */ }
  if (text == null && !S.clip) return toast('El navegador no dejó leer el portapapeles. Usa Ctrl+V para pegar.');
  doPaste(text, html, mode);
}
// Insertar celdas copiadas: abre filas y pega
function insertCopied() {
  if (!S.clip) return toast('Primero copia celdas de la hoja (Ctrl+C).');
  const h = S.clip.m.length, R = rng();
  shiftStructure('r', R.r1, h);
  select(R.r1, R.c1, R.r1, R.c1, false);
  doPaste(null, null, 'all');
}

// ================================================================== RELLENAR (controlador de relleno)
function incText(v, k) {
  const m = /^(.*?)(\d+)$/.exec(v);
  if (!m || v.startsWith('=')) return v;
  return m[1] + String(+m[2] + k).padStart(m[2].length, '0');
}
function doFill(src, dst) {
  const cells = cellsOf(S.sid), upd = {};
  const down = dst.r2 > src.r2 || dst.r1 < src.r1;
  if (down) {
    const h = src.r2 - src.r1 + 1;
    for (let c = src.c1; c <= src.c2; c++) {
      const vals = []; for (let r = src.r1; r <= src.r2; r++) vals.push(cells[keyOf(r, c)]);
      const nums = vals.map(x => x && x.v && !x.v.startsWith('=') && !isNaN(+x.v) ? +x.v : null);
      const series = h > 1 && nums.every(n => n !== null);
      const step = series ? (nums[h - 1] - nums[0]) / (h - 1) : 0;
      for (let r = dst.r1; r <= dst.r2; r++) {
        if (r >= src.r1 && r <= src.r2) continue;
        const off = ((r - src.r1) % h + h) % h, s = vals[off];
        let v = s?.v;
        if (series) v = String(+(nums[0] + step * (r - src.r1)).toFixed(10));
        else if (v && v.startsWith('=')) v = shiftFormula(v, r - (src.r1 + off), 0);
        else if (v && h === 1) v = incText(v, r - src.r1);
        upd[`celdas/${S.sid}/${keyOf(r, c)}`] = s ? cellObj(v, s.s) : null;
      }
    }
  } else {
    const w = src.c2 - src.c1 + 1;
    for (let r = src.r1; r <= src.r2; r++) {
      const vals = []; for (let c = src.c1; c <= src.c2; c++) vals.push(cells[keyOf(r, c)]);
      const nums = vals.map(x => x && x.v && !x.v.startsWith('=') && !isNaN(+x.v) ? +x.v : null);
      const series = w > 1 && nums.every(n => n !== null);
      const step = series ? (nums[w - 1] - nums[0]) / (w - 1) : 0;
      for (let c = dst.c1; c <= dst.c2; c++) {
        if (c >= src.c1 && c <= src.c2) continue;
        const off = ((c - src.c1) % w + w) % w, s = vals[off];
        let v = s?.v;
        if (series) v = String(+(nums[0] + step * (c - src.c1)).toFixed(10));
        else if (v && v.startsWith('=')) v = shiftFormula(v, 0, c - (src.c1 + off));
        else if (v && w === 1) v = incText(v, c - src.c1);
        upd[`celdas/${S.sid}/${keyOf(r, c)}`] = s ? cellObj(v, s.s) : null;
      }
    }
  }
  write(upd);
  select(dst.r1, dst.c1, dst.r2, dst.c2, false);
}

// ================================================================== FILAS / COLUMNAS
function shiftStructure(axis, at, n) {
  const sid = S.sid, sh = cur(), name = sh.nombre, cells = cellsOf(sid), nm = {};
  for (const [k, cell] of Object.entries(cells)) {
    const p = parseKey(k); if (!p) continue;
    let { r, c } = p; const idx = axis === 'r' ? r : c;
    if (n < 0 && idx >= at && idx < at - n) continue;
    if (idx >= at) { if (axis === 'r') r += n; else c += n; }
    const x = { ...cell };
    if (x.v && x.v[0] === '=') x.v = adjustRefs(x.v, name, name, axis, at, n);
    nm[keyOf(r, c)] = x;
  }
  const upd = { ['celdas/' + sid]: Object.keys(nm).length ? nm : null };
  for (const [sid2, m] of Object.entries(S.tree.celdas)) {
    if (sid2 === sid) continue;
    const own = S.tree.hojas[sid2]?.nombre || '';
    for (const [k, cell] of Object.entries(m)) {
      if (!cell.v || cell.v[0] !== '=' || !cell.v.toLowerCase().includes(name.toLowerCase())) continue;
      const nv = adjustRefs(cell.v, own, name, axis, at, n);
      if (nv !== cell.v) upd[`celdas/${sid2}/${k}`] = { ...cell, v: nv };
    }
  }
  const prop = axis === 'r' ? 'altos' : 'anchos', pre = axis === 'r' ? 'r' : 'c', old = sh[prop] || {}, nn = {};
  for (const [kk, v] of Object.entries(old)) {
    let j = +kk.slice(1);
    if (n < 0 && j >= at && j < at - n) continue;
    if (j >= at) j += n;
    nn[pre + j] = v;
  }
  upd[`hojas/${sid}/${prop}`] = Object.keys(nn).length ? nn : null;
  write(upd);
}
const insRows = () => { const R = rng(); shiftStructure('r', R.r1, R.r2 - R.r1 + 1); };
const insCols = () => { const R = rng(); shiftStructure('c', R.c1, R.c2 - R.c1 + 1); };
const delRows = () => { const R = boundedSel(); shiftStructure('r', R.r1, -(R.r2 - R.r1 + 1)); select(R.r1, S.sel.ac); };
const delCols = () => { const R = boundedSel(); shiftStructure('c', R.c1, -(R.c2 - R.c1 + 1)); select(S.sel.ar, R.c1); };

function setSize(axis, idxs, px) {
  const upd = {}, prop = axis === 'c' ? 'anchos' : 'altos';
  for (const i of idxs) upd[`hojas/${S.sid}/${prop}/${axis}${i}`] = px == null ? null : Math.max(axis === 'c' ? 8 : 6, Math.round(px));
  write(upd);
}
function autofitCol(c) {
  const cells = cellsOf(S.sid); let w = 30;
  for (const k in cells) {
    const p = parseKey(k); if (!p || p.c !== c) continue;
    const s = cells[k].s || {};
    const t = display(calc.value(S.sid, p.r, c), s).t;
    for (const line of t.split('\n')) w = Math.max(w, measure(line, fontCss(s, 1)) + 10);
  }
  setSize('c', [c], Math.min(w, 600));
}

// ================================================================== ORDENAR
function sortSel(desc) {
  const R = boundedSel();
  if (R.r1 === R.r2) return toast('Selecciona varias filas para ordenar (por ejemplo A2:H20).');
  const key = S.sel.ac, cells = cellsOf(S.sid);
  const rows = [];
  for (let r = R.r1; r <= R.r2; r++) {
    const row = []; for (let c = R.c1; c <= R.c2; c++) row.push(cells[keyOf(r, c)] || null);
    rows.push({ r, row, v: calc.value(S.sid, r, key) });
  }
  rows.sort((a, b) => {
    if (a.v == null && b.v == null) return 0;
    if (a.v == null) return 1; if (b.v == null) return -1;
    const k = compareValues(a.v instanceof FErr ? '' : a.v, b.v instanceof FErr ? '' : b.v);
    return desc ? -k : k;
  });
  const upd = {};
  rows.forEach((x, i) => {
    const r = R.r1 + i;
    x.row.forEach((cell, j) => {
      let v = cell?.v; if (v && v[0] === '=') v = shiftFormula(v, r - x.r, 0);
      upd[`celdas/${S.sid}/${keyOf(r, R.c1 + j)}`] = cell ? cellObj(v, cell.s) : null;
    });
  });
  write(upd);
}

// ================================================================== HOJAS
function uniqueName(base) {
  const names = new Set(Object.values(S.tree.hojas).map(h => (h.nombre || '').toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let i = 2; while (names.has(`${base} (${i})`.toLowerCase())) i++;
  return `${base} (${i})`;
}
const newSid = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const nextOrder = () => Math.max(-1, ...Object.values(S.tree.hojas).map(h => h.orden ?? 0)) + 1;
function addSheet(name) {
  const n = Object.keys(S.tree.hojas).length + 1;
  const sid = newSid();
  write({ ['hojas/' + sid]: { nombre: uniqueName(name || 'Hoja' + n), orden: nextOrder() } });
  switchSheet(sid);
  return sid;
}
async function renameSheet(sid) {
  const old = S.tree.hojas[sid]?.nombre; if (old == null) return;
  const v = (await dialog({ title: 'Cambiar nombre de la hoja', input: old }))?.trim();
  if (!v || v === old) return focusGrid();
  if (/[\\/?*[\]:]/.test(v)) { toast('El nombre no puede contener \\ / ? * [ ] :', 'err'); return focusGrid(); }
  if (model.sheetIdByName(v) && model.sheetIdByName(v) !== sid) { toast('Ya existe una hoja con ese nombre', 'err'); return focusGrid(); }
  await loadAll('Actualizando las fórmulas que usan esta hoja…');
  const upd = { [`hojas/${sid}/nombre`]: v };
  for (const [s2, m] of Object.entries(S.tree.celdas)) for (const [k, cell] of Object.entries(m)) {
    if (!cell.v || cell.v[0] !== '=') continue;
    const nv = renameSheetRefs(cell.v, old, v);
    if (nv !== cell.v) upd[`celdas/${s2}/${k}`] = { ...cell, v: nv };
  }
  write(upd); focusGrid();
}
async function deleteSheet(sid) {
  if (Object.keys(S.tree.hojas).length < 2) return toast('El libro debe tener al menos una hoja.', 'err');
  const ok = await dialog({ title: 'Eliminar hoja', text: `¿Eliminar la hoja "${esc(S.tree.hojas[sid].nombre)}" para todos los usuarios? Puedes deshacer con Ctrl+Z.`, ok: 'Eliminar' });
  if (!ok) return focusGrid();
  const list = sortedSheets().map(x => x[0]), i = list.indexOf(sid);
  const orig = S.tree.hojas[sid].origen || (/^s\d{3}$/.test(sid) ? S.tree.hojas[sid].nombre : null);
  const del = { ['hojas/' + sid]: null, ['celdas/' + sid]: null, ['bases/' + sid]: null };
  if (orig) del[`meta/borradas/${fnv(orig.toLowerCase())}`] = true;
  write(del);
  if (sid === S.sid) switchSheet(list[i + 1] || list[i - 1]);
  focusGrid();
}
function moveSheet(sid, d) {
  const list = sortedSheets().map(x => x[0]), i = list.indexOf(sid), j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const upd = {}; list.forEach((s, k) => { upd[`hojas/${s}/orden`] = k; });
  write(upd);
}
let tabsT = 0;
function scheduleTabs() { clearTimeout(tabsT); tabsT = setTimeout(renderTabs, 30); }
function renderTabs() {
  U.stabs.innerHTML = sortedSheets().map(([id, h]) => `<button class="stab${id === S.sid ? ' on' : ''}" data-sid="${id}">${esc(h.nombre || 'Hoja')}</button>`).join('');
  const on = U.stabs.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateTitle();
}

// ================================================================== PLANTILLA DE PEDIDO (formato del repositorio)
function insertTemplate() {
  const d = new Date(), M = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const sid = newSid(), name = uniqueName(`${String(d.getDate()).padStart(2, '0')} de ${M[d.getMonth()].toLowerCase()}`);
  const c = {}, hdr = { b: 1, f: '#e2efda', bd: 'a', a: 'c' }, bd = { bd: 'a' };
  c.B2 = { v: `PEDIDO DEL ${String(d.getDate()).padStart(2, '0')} ${M[d.getMonth()]}`, s: { b: 1, fs: 14 } };
  ['Item No.', 'Item Description', 'Quantity', 'Proveedor', 'Ingreso', 'Precio', 'P. Uni.', 'Total'].forEach((t, i) => { c[keyOf(2, i)] = { v: t, s: hdr }; });
  for (let r = 3; r < 23; r++) {
    const n = r + 1;
    for (let i = 0; i < 8; i++) c[keyOf(r, i)] = { s: { ...bd } };
    c[keyOf(r, 4)].s.nf = 'date';
    c[keyOf(r, 6)] = { v: `=SI(F${n}="";"";SI.ERROR(VALOR(EXTRAE(F${n};5;20));""))`, s: { bd: 'a', nf: 'num', d: 4 } };
    c[keyOf(r, 7)] = { v: `=SI(G${n}="";"";C${n}*G${n})`, s: { bd: 'a', nf: 'num' } };
  }
  c.A4.v = '202020158'; c.B4.v = 'SPRITE X 0.4 LT.'; c.C4.v = '12'; c.D4.v = 'AC COMERCIAL'; c.E4.v = String(todaySerial()); c.F4.v = 'SOL 1.596667';
  c.H24 = { v: '=SUMA(H4:H23)', s: { b: 1, nf: 'num', bd: 'a' } }; c.I24 = { v: 'TOTAL', s: { b: 1 } };
  c.H25 = { v: '=H24*0.18', s: { nf: 'num', bd: 'a' } }; c.I25 = { v: 'IGV (18%)' };
  c.H26 = { v: '=H24+H25', s: { b: 1, nf: 'num', bd: 'a', f: '#e2efda' } }; c.I26 = { v: 'TOTAL + IGV', s: { b: 1 } };
  const anchos = { c0: 90, c1: 280, c2: 70, c3: 140, c4: 86, c5: 110, c6: 80, c7: 96, c8: 100 };
  write({ ['hojas/' + sid]: { nombre: name, orden: nextOrder(), anchos }, ['celdas/' + sid]: c });
  switchSheet(sid);
  select(4, 0);
  toast('Plantilla creada. En "Precio" escribe por ejemplo "SOL 1.596667" o "USD 21.00".');
}

// ================================================================== IMPORTAR / EXPORTAR
let xlsxP = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxP) xlsxP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.charset = 'utf-8';
    s.onload = () => res(window.XLSX); s.onerror = () => { xlsxP = null; rej(new Error('No se pudo cargar el lector de Excel (¿sin internet?)')); };
    document.head.appendChild(s);
  });
  return xlsxP;
}
function nfFromZ(z, X) {
  if (!z || z === 'General') return {};
  if (X.SSF.is_date(z)) return /h|s/i.test(z.replace(/\[.*?\]/g, '')) && !/d|y/i.test(z) ? { nf: 'time' } : { nf: 'date' };
  const dec = ((/\.([0#]+)/.exec(z) || [])[1] || '').length;
  if (z.includes('%')) return { nf: 'pct', d: dec };
  if (/S\//.test(z) || /PEN/.test(z)) return { nf: 'cur', d: dec };
  if (/\$/.test(z)) return { nf: 'usd', d: dec };
  if (/,/.test(z) || dec) return { nf: 'num', d: dec };
  return {};
}
async function importFile(file) {
  toast('Leyendo ' + file.name + '…');
  return importBuffer(await file.arrayBuffer(), false);
}
// Primera apertura de un libro del repositorio: carga su .xlsx en Firebase.
// Usa identificadores fijos (s000, s001…) para que, si dos personas lo abren a la vez, no se dupliquen las hojas.
async function seedBook(lb) {
  const box = document.createElement('div');
  box.className = 'loading';
  box.innerHTML = `<div class="lbox2"><span class="spin"></span><b>Preparando ${esc(lb.nombre)}</b><span id="loadmsg">Descargando el archivo…</span></div>`;
  document.body.appendChild(box);
  try {
    const r = await fetch(encodeURI(lb.archivo), { cache: 'no-cache' });
    if (!r.ok) throw new Error('No se encontró el archivo ' + lb.archivo);
    const tag = r.headers.get('etag') || r.headers.get('last-modified') || '';
    const buf = await r.arrayBuffer();
    await importBuffer(buf, true, (i, n) => { const m = document.getElementById('loadmsg'); if (m) m.textContent = `Guardando hoja ${i} de ${n} en la nube…`; });
    await write({ 'meta/nombre': lb.nombre, 'meta/archivo': fileId(buf), 'meta/archivoEtag': tag, 'meta/importado': new Date().toISOString(), 'meta/estilos': STYLE_VERSION }, false);
  } catch (e) {
    toast('No se pudo cargar el libro: ' + e.message, 'err', 10000);
    write({ 'hojas/h1': { nombre: 'Hoja1', orden: 0 } }, false); switchSheet('h1');
  } finally { box.remove(); }
}
// Convierte una hoja del .xlsx en celdas {v, s} con su formato original (bordes, letra, relleno…)
function sheetCells(X, ws, fmt) {
  const cells = {};
  let mr = -1, mc = -1;
  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    const x = ws[addr];
    if (x.v == null && !x.f) continue;
    const p = X.utils.decode_cell(addr);
    if (p.r <= 20000 && p.c <= 200) { if (p.r > mr) mr = p.r; if (p.c > mc) mc = p.c; }
  }
  const keys = new Set(Object.keys(ws).filter(a => a[0] !== '!'));
  for (const a of Object.keys(fmt || {})) keys.add(a);
  for (const addr of keys) {
    const x = ws[addr] || {}, p = X.utils.decode_cell(addr);
    if (p.r > 20000 || p.c > 200) continue;
    let v = null; const s = { ...((fmt || {})[addr] || {}) };
    if (x.f) v = '=' + x.f;
    else if (x.t === 'n') v = String(x.v);
    else if (x.t === 'b') v = x.v ? 'VERDADERO' : 'FALSO';
    else if (x.t === 'e') v = x.w || '#N/A';
    else if (x.t === 's' || x.t === 'str') v = x.v == null ? '' : String(x.v);
    else if (x.t === 'd') v = String(x.v);
    if (x.t === 'n' || (x.f && typeof x.v === 'number')) Object.assign(s, nfFromZ(x.z, X));
    if (x.t === 's' && /^\d/.test(v) && !isNaN(+v)) v = "'" + v;
    if (!s.f) { const fg = x.s && x.s.patternType === 'solid' && x.s.fgColor && x.s.fgColor.rgb; if (fg && fg !== 'FFFFFF' && /^[0-9A-F]{6,8}$/i.test(fg)) s.f = '#' + fg.slice(-6).toLowerCase(); }
    if (typeof v === 'string' && v.includes('\n')) s.w = 1;
    // celdas vacías solo con formato: se guardan si están cerca de los datos (evita miles de celdas inútiles)
    if ((v == null || v === '') && (p.r > mr + 3 || p.c > mc + 2 || !(s.f || s.bd || s.bt || s.bb || s.bl || s.br))) continue;
    const o = cellObj(v, s); if (o) cells[keyOf(p.r, p.c)] = o;
  }
  const anchos = {}, altos = {};
  (ws['!cols'] || []).forEach((c, i) => { if (c && !c.hidden) { const px = c.wpx || (c.wch ? Math.round(c.wch * 7 + 5) : 0); if (px && Math.abs(px - DEF_W) > 2) anchos['c' + i] = Math.round(px); } });
  (ws['!rows'] || []).forEach((r, i) => { if (r && i <= mr + 3) { const px = r.hpt ? Math.round(r.hpt * 4 / 3) : (r.hpx || 0); if (px >= 12 && Math.abs(px - DEF_H) > 1) altos['r' + i] = px; } });
  return { cells, anchos, altos };
}
const STYLE_VERSION = 2;
function readWorkbook(X, buf) {
  const wb = X.read(buf, { type: 'array', cellFormula: true, cellNF: true, cellStyles: true, cellDates: false, bookFiles: true });
  let fmt = {};
  try { fmt = extractStyles(wb); } catch (e) { console.warn('Sin formato original', e); }
  return { wb, fmt };
}
// Libros ya cargados antes de leer el formato: aplica bordes, letras y rellenos del Excel original una sola vez
let upgrading = false;
async function upgradeStyles(lb) {
  if (upgrading) return; upgrading = true;
  try {
    const X = await loadXLSX();
    const r = await fetch(encodeURI('datos/base/' + lb.archivo), { cache: 'no-cache' }); if (!r.ok) return;
    const { wb, fmt } = readWorkbook(X, await r.arrayBuffer());
    U.sinfo.textContent = 'Aplicando el formato del Excel original…';
    let idx = 0;
    for (const name of wb.SheetNames) {
      idx++;
      const sid = 's' + String(idx).padStart(3, '0');
      if (!S.tree.hojas[sid] || !wb.Sheets[name]) continue;
      const { cells, anchos, altos } = sheetCells(X, wb.Sheets[name], fmt[name]);
      const upd = {};
      for (const [k, o] of Object.entries(cells)) if (o.s) upd[`celdas/${sid}/${k}/s`] = o.s;
      upd[`hojas/${sid}/anchos`] = Object.keys(anchos).length ? anchos : null;
      upd[`hojas/${sid}/altos`] = Object.keys(altos).length ? altos : null;
      await write(upd, false);
    }
    await write({ 'meta/estilos': STYLE_VERSION }, false);
    U.sinfo.textContent = '';
    toast('Se aplicaron los bordes y el formato del Excel original', 'ok');
  } catch (e) { console.warn(e); } finally { upgrading = false; }
}
// Mantenimiento al abrir un libro del hotel: formato original (una vez) y cambios del archivo Excel
let maintained = false;
async function maybeUpgrade() {
  const lb = libroById(S.book);
  if (!lb || maintained || !S.ready || !S.metaLoaded || !sortedSheets().length || !S.tree.meta.importado) return;
  maintained = true;
  try {
    if ((S.tree.meta.estilos || 0) < STYLE_VERSION) await upgradeStyles(lb);
    await checkFileUpdate(lb);
  } catch (e) { console.warn(e); U.sinfo.textContent = ''; }
}

// ---------- huellas: permiten actualizar solo lo que cambió
function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
function fileId(buf) { const u = new Uint8Array(buf); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + u.length.toString(36); }
function fingerprint(cells, anchos, altos) {
  const hashes = {}; let acc = '';
  for (const k of Object.keys(cells).sort()) { const h = fnv(JSON.stringify(cells[k])); hashes[k] = h; acc += k + h; }
  const dims = fnv(JSON.stringify([anchos, altos]));
  return { hashes, dims, huella: fnv(acc + '|' + dims) + Object.keys(hashes).length.toString(36) };
}
const orNull = o => (o && Object.keys(o).length ? o : null);

// ¿Se subió una versión nueva del Excel? Primero pregunta solo la cabecera (sin descargar el archivo).
async function checkFileUpdate(lb) {
  const url = encodeURI(lb.archivo);
  let tag = '';
  try { const h = await fetch(url, { method: 'HEAD', cache: 'no-cache' }); if (h.ok) tag = h.headers.get('etag') || h.headers.get('last-modified') || ''; } catch { /* sin red */ }
  if (tag && tag === S.tree.meta.archivoEtag) return;
  const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) return;
  const buf = await r.arrayBuffer(), id = fileId(buf);
  const known = S.tree.meta.archivo || lb.baseId;
  if (id !== known) await syncBook(buf, lb);
  await write({ 'meta/archivo': id, 'meta/archivoEtag': tag || null }, false);
}

// Sincroniza el libro con un Excel: compara hoja por hoja (huella) y celda por celda (contra la versión anterior
// del archivo). Solo escribe lo que el Excel cambió; lo editado en la página en otras celdas se respeta.
let syncing = false;
async function syncBook(buf, lb) {
  if (syncing) return; syncing = true;
  try {
    const X = await loadXLSX();
    const { wb, fmt } = readWorkbook(X, buf);
    let baseWb = null;
    const getBase = async () => {
      if (baseWb !== null) return baseWb;
      baseWb = false;
      if (lb) { try { const r = await fetch(encodeURI('datos/base/' + lb.archivo), { cache: 'no-cache' }); if (r.ok) baseWb = readWorkbook(X, await r.arrayBuffer()); } catch { /* sin copia */ } }
      return baseWb;
    };
    const borradas = S.tree.meta.borradas || {};
    let hojasCambiadas = 0, celdas = 0, nuevas = 0, idx = 0, prevOrden = -1;
    for (const name of wb.SheetNames) {
      idx++;
      const ws = wb.Sheets[name]; if (!ws) continue;
      U.sinfo.textContent = `Revisando el Excel: hoja ${idx} de ${wb.SheetNames.length}…`;
      const { cells, anchos, altos } = sheetCells(X, ws, fmt[name]);
      const fp = fingerprint(cells, anchos, altos);
      const ln = name.toLowerCase(), list = sortedSheets();
      const hit = list.find(([, h]) => (h.origen || '').toLowerCase() === ln) || list.find(([, h]) => !h.origen && (h.nombre || '').toLowerCase() === ln);
      if (!hit) {
        if (borradas[fnv(ln)]) continue; // la borraron en la página: no se vuelve a crear
        const sid = 'x' + fnv(ln), orden = prevOrden + 0.001;
        const meta = { nombre: uniqueName(name), orden, origen: name, huella: fp.huella, dims: fp.dims };
        if (orNull(anchos)) meta.anchos = anchos; if (orNull(altos)) meta.altos = altos;
        S.tree.hojas[sid] = meta;
        await write({ ['hojas/' + sid]: meta, ['celdas/' + sid]: orNull(cells), ['bases/' + sid]: orNull(fp.hashes) }, false);
        nuevas++; prevOrden = orden; continue;
      }
      const [sid, h] = hit;
      prevOrden = h.orden ?? prevOrden;
      if (h.huella === fp.huella) continue; // hoja sin cambios: ni se lee
      let base = await store.read('bases/' + sid), baseDims = h.dims;
      if (!base) {
        const bw = await getBase(), bws = bw && bw.wb.Sheets[name];
        if (bws) { const b = sheetCells(X, bws, bw.fmt[name]), bf = fingerprint(b.cells, b.anchos, b.altos); base = bf.hashes; baseDims = bf.dims; }
        else base = {};
      }
      const upd = {}; let n = 0;
      for (const k of new Set([...Object.keys(fp.hashes), ...Object.keys(base)])) {
        if (fp.hashes[k] === base[k]) continue;
        upd[`celdas/${sid}/${k}`] = cells[k] || null; n++;
      }
      if (fp.dims !== baseDims) { upd[`hojas/${sid}/anchos`] = orNull(anchos); upd[`hojas/${sid}/altos`] = orNull(altos); }
      Object.assign(upd, { [`hojas/${sid}/huella`]: fp.huella, [`hojas/${sid}/dims`]: fp.dims, [`hojas/${sid}/origen`]: name, ['bases/' + sid]: orNull(fp.hashes) });
      await write(upd, false);
      if (n) { hojasCambiadas++; celdas += n; }
    }
    U.sinfo.textContent = '';
    if (hojasCambiadas || nuevas) toast(`Excel actualizado: ${celdas.toLocaleString('es-PE')} celdas cambiadas en ${hojasCambiadas} hojas${nuevas ? `, ${nuevas} hojas nuevas` : ''}. El resto quedó igual.`, 'ok', 8000);
    else toast('El Excel no tiene cambios respecto a la nube.', 'info');
    renderTabs();
  } finally { syncing = false; U.sinfo.textContent = ''; }
}
async function importBuffer(buf, seed, progress) {
  let X;
  try { X = await loadXLSX(); } catch (e) { return toast(e.message, 'err'); }
  const { wb, fmt } = readWorkbook(X, buf);
  let first = null, order = seed ? 0 : nextOrder(), total = 0, idx = 0;
  for (const name of wb.SheetNames) {
    idx++; if (progress) progress(idx, wb.SheetNames.length);
    const ws = wb.Sheets[name]; if (!ws) continue;
    const { cells, anchos, altos } = sheetCells(X, ws, fmt[name]);
    const sid = seed ? 's' + String(idx).padStart(3, '0') : newSid();
    const meta = { nombre: seed ? name : uniqueName(name), orden: order++ };
    if (Object.keys(anchos).length) meta.anchos = anchos;
    if (Object.keys(altos).length) meta.altos = altos;
    const upd = { ['hojas/' + sid]: meta, ['celdas/' + sid]: Object.keys(cells).length ? cells : null };
    if (seed) { const fp = fingerprint(cells, anchos, altos); Object.assign(meta, { origen: name, huella: fp.huella, dims: fp.dims }); upd['bases/' + sid] = Object.keys(fp.hashes).length ? fp.hashes : null; }
    S.tree.hojas[sid] = meta; // reserva el nombre para la siguiente hoja
    await write(upd, false);
    total += Object.keys(cells).length;
    if (!first) { first = sid; if (seed) switchSheet(sid); }
  }
  if (first && !seed) switchSheet(first);
  toast(`${seed ? 'Libro listo' : 'Importado'}: ${wb.SheetNames.length} hojas, ${total.toLocaleString('es-PE')} celdas. Ya está guardado y compartido.`, 'ok', 6000);
}
const XLSX_FMT = { num: d => '#,##0' + (d ? '.' + '0'.repeat(d) : ''), cur: d => '"S/" #,##0' + (d ? '.' + '0'.repeat(d) : ''), usd: d => '"$" #,##0' + (d ? '.' + '0'.repeat(d) : ''), pct: d => '0' + (d ? '.' + '0'.repeat(d) : '') + '%', date: () => 'dd/mm/yyyy', time: () => 'hh:mm' };
async function exportXlsx() {
  let X; try { X = await loadXLSX(); } catch (e) { return toast(e.message, 'err'); }
  await loadAll('Descargando todas las hojas para el archivo…');
  const wb = X.utils.book_new(), used = new Set();
  for (const [sid, h] of sortedSheets()) {
    const ws = {}, cells = cellsOf(sid); let mr = 0, mc = 0;
    for (const [k, cell] of Object.entries(cells)) {
      const p = parseKey(k); if (!p || cell.v == null) continue;
      const v = calc.value(sid, p.r, p.c), s = cell.s || {};
      const o = {};
      if (v instanceof FErr) { o.t = 'e'; o.v = 0; o.w = v.code; }
      else if (typeof v === 'number') { o.t = 'n'; o.v = v; }
      else if (typeof v === 'boolean') { o.t = 'b'; o.v = v; }
      else { o.t = 's'; o.v = v == null ? '' : String(v); }
      if (cell.v[0] === '=') o.f = toEnglish(cell.v);
      if (s.nf && XLSX_FMT[s.nf]) o.z = XLSX_FMT[s.nf](s.d ?? (s.nf === 'pct' ? 0 : 2));
      ws[X.utils.encode_cell(p)] = o;
      mr = Math.max(mr, p.r); mc = Math.max(mc, p.c);
    }
    ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mr, c: mc } });
    const an = h.anchos || {}; ws['!cols'] = Array.from({ length: mc + 1 }, (_, i) => ({ wpx: an['c' + i] || DEF_W }));
    let nm = (h.nombre || 'Hoja').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja';
    while (used.has(nm.toLowerCase())) nm = nm.slice(0, 28) + '_' + used.size;
    used.add(nm.toLowerCase());
    X.utils.book_append_sheet(wb, ws, nm);
  }
  X.writeFile(wb, (S.tree.meta.nombre || 'Libro1') + '.xlsx');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCsv() {
  const e = model.extent(S.sid); const lines = [];
  for (let r = 0; r <= e.r; r++) {
    const row = [];
    for (let c = 0; c <= e.c; c++) { const t = display(calc.value(S.sid, r, c), cellAt(r, c)?.s).t; row.push(/[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t); }
    lines.push(row.join(','));
  }
  download(cur().nombre + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
}
function printSheet() {
  const e = model.extent(S.sid); if (e.r < 0) return toast('La hoja está vacía');
  let h = `<title>${esc(cur().nombre)}</title><style>body{font:12px Calibri,Arial}table{border-collapse:collapse}td{border:1px solid #ccc;padding:2px 5px;white-space:pre-wrap}</style><table>`;
  for (let r = 0; r <= e.r; r++) {
    h += '<tr>';
    for (let c = 0; c <= e.c; c++) {
      const s = cellAt(r, c)?.s || {}, d = display(calc.value(S.sid, r, c), s);
      h += `<td style="text-align:${{ l: 'left', r: 'right', c: 'center' }[s.a || d.al]};${s.b ? 'font-weight:bold;' : ''}${s.f ? 'background:' + s.f : ''}">${esc(d.t)}</td>`;
    }
    h += '</tr>';
  }
  const w = window.open('', '_blank'); if (!w) return toast('Permite las ventanas emergentes para imprimir', 'err');
  w.document.write(h + '</table>'); w.document.close(); w.focus(); w.print();
}

// ================================================================== BUSCAR
async function find() {
  const q = (await dialog({ title: 'Buscar', input: S.lastFind || '', ok: 'Buscar siguiente' }))?.trim();
  focusGrid(); if (!q) return;
  S.lastFind = q;
  const needle = q.toLowerCase(), list = [];
  for (const k of Object.keys(cellsOf(S.sid))) {
    const p = parseKey(k); if (!p) continue;
    const t = display(calc.value(S.sid, p.r, p.c), cellAt(p.r, p.c)?.s).t.toLowerCase();
    if (t.includes(needle) || (cellAt(p.r, p.c)?.v || '').toLowerCase().includes(needle)) list.push(p);
  }
  if (!list.length) return toast(`No se encontró "${q}"`);
  list.sort((a, b) => a.r - b.r || a.c - b.c);
  const { ar, ac } = S.sel;
  const nx = list.find(p => p.r > ar || (p.r === ar && p.c > ac)) || list[0];
  select(nx.r, nx.c);
  toast(`${list.length} coincidencia(s)`);
}

// ================================================================== AUTOSUMA
function autoFn(fn) {
  const R = rng();
  if (R.r1 !== R.r2 || R.c1 !== R.c2) {
    const upd = {};
    for (let c = R.c1; c <= R.c2; c++) upd[`celdas/${S.sid}/${keyOf(R.r2 + 1, c)}`] = cellObj(`=${fn}(${keyOf(R.r1, c)}:${keyOf(R.r2, c)})`, cellAt(R.r2 + 1, c)?.s);
    write(upd); return;
  }
  const { ar: r, ac: c } = S.sel;
  const isNum = (rr, cc) => typeof calc.value(S.sid, rr, cc) === 'number';
  let ref = '';
  if (r > 0 && isNum(r - 1, c)) { let t = r - 1; while (t > 0 && isNum(t - 1, c)) t--; ref = `${keyOf(t, c)}:${keyOf(r - 1, c)}`; }
  else if (c > 0 && isNum(r, c - 1)) { let t = c - 1; while (t > 0 && isNum(r, t - 1)) t--; ref = `${keyOf(r, t)}:${keyOf(r, c - 1)}`; }
  startEdit(`=${fn}(${ref})`, 'edit');
  if (!ref) { const p = U.ed.value.length - 1; U.ed.setSelectionRange(p, p); }
}

// ================================================================== MENÚS
function colorMenu(at, kind) {
  const cells = STD_COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
  const m = menu([{ html: `<div class="swatches">${cells}</div>` }, '-',
    { icon: kind === 'fill' ? 'format_color_reset' : 'format_color_text', label: kind === 'fill' ? 'Sin relleno' : 'Automático', run: () => styleSel(s => ({ ...s, [kind === 'fill' ? 'f' : 'c']: undefined })) },
    { icon: 'palette', label: 'Más colores…', run: () => { const i = document.createElement('input'); i.type = 'color'; i.value = kind === 'fill' ? S.fillColor : S.fontColor; i.oninput = () => applyColor(kind, i.value); i.click(); } }], at);
  m.querySelectorAll('.sw').forEach(b => b.addEventListener('click', () => { closeMenu(); applyColor(kind, b.dataset.c); focusGrid(); }));
}
function applyColor(kind, col) {
  if (kind === 'fill') { S.fillColor = col; U.fillBar.style.background = col; styleSel(s => ({ ...s, f: col })); }
  else { S.fontColor = col; U.colorBar.style.background = col; styleSel(s => ({ ...s, c: col })); }
}
const PASTE_OPTS = [
  ['all', '', 'Pegar (P)'], ['values', '123', 'Valores (V)'], ['formulas', 'fx', 'Fórmulas (F)'],
  ['transpose', '⇄', 'Transponer (T)'], ['formats', '%', 'Formato (R)'], ['link', '🔗', 'Pegar vínculo (N)']
];
const pasteIconsHtml = () => `<div class="pasteopts">${PASTE_OPTS.map(([m, b, t]) => `<button class="pi" data-pm="${m}" title="${t}"><span class="ms">content_paste</span>${b ? `<i>${b}</i>` : ''}</button>`).join('')}</div>`;
const bindPaste = (el, close) => el.querySelectorAll('.pi').forEach(b => b.addEventListener('click', () => { close(); pasteMode(b.dataset.pm); }));
function pasteSpecialItems() {
  return [
    { title: 'Pegar' },
    { icon: 'content_paste', label: 'Pegar', run: () => pasteMode('all') },
    { icon: 'function', label: 'Fórmulas', run: () => pasteMode('formulas') },
    { icon: 'swap_horiz', label: 'Transponer', run: () => pasteMode('transpose') },
    { title: 'Pegar valores' },
    { icon: 'pin', label: 'Valores', run: () => pasteMode('values') },
    { title: 'Otras opciones de pegado' },
    { icon: 'format_paint', label: 'Formato', run: () => pasteMode('formats') },
    { icon: 'link', label: 'Pegar vínculo', run: () => pasteMode('link') }
  ];
}
function cellMenu(x, y) {
  const st = activeStyle();
  menu([
    { search: 'Buscar en los menús' },
    { icon: 'content_cut', label: 'Cortar', hint: 'Ctrl+X', run: () => doCopy(true) },
    { icon: 'content_copy', label: 'Copiar', hint: 'Ctrl+C', run: () => doCopy(false) },
    { title: 'Opciones de pegado:', icon: 'content_paste' },
    { html: pasteIconsHtml(), bind: bindPaste },
    { icon: '', label: 'Pegado especial…', hint: 'Ctrl+Alt+V', sub: pasteSpecialItems },
    '-',
    { icon: 'add_row_above', label: 'Insertar celdas copiadas…', disabled: !S.clip, run: insertCopied },
    { icon: '', label: 'Insertar…', sub: [
      { icon: 'table_rows', label: 'Filas arriba', run: insRows }, { icon: 'view_week', label: 'Columnas a la izquierda', run: insCols }] },
    { icon: '', label: 'Eliminar…', sub: [
      { icon: 'delete_sweep', label: 'Toda la fila', run: delRows }, { icon: 'delete', label: 'Toda la columna', run: delCols }] },
    { icon: '', label: 'Borrar contenido', hint: 'Supr', run: () => clearSel('content') },
    '-',
    { icon: 'bolt', label: 'Análisis rápido', disabled: true },
    { icon: '', label: 'Filtrar', disabled: true, sub: [] },
    { icon: '', label: 'Ordenar', sub: [
      { icon: 'north', label: 'Ordenar de A a Z', run: () => sortSel(false) }, { icon: 'south', label: 'Ordenar de Z a A', run: () => sortSel(true) }] },
    '-',
    { icon: 'table_view', label: 'Obtener datos de tabla o rango…', run: () => runCmd('import') },
    '-',
    { icon: 'add_comment', label: st.nt ? 'Editar comentario' : 'Nuevo comentario', run: editNote },
    { icon: 'sticky_note_2', label: st.nt ? 'Editar nota' : 'Nueva nota', run: editNote },
    ...(st.nt ? [{ icon: 'speaker_notes_off', label: 'Eliminar nota', run: () => styleSel(s => ({ ...s, nt: undefined })) }] : []),
    '-',
    { icon: 'tune', label: 'Formato de celdas…', hint: 'Ctrl+1', run: formatCells },
    { icon: '', label: 'Elegir de la lista desplegable…', hint: 'Alt+↓', run: pickFromList },
    { icon: '', label: 'Definir nombre…', disabled: true },
    '-',
    { icon: 'link', label: 'Vínculo', disabled: true, sub: [] },
    { icon: '', label: 'Abrir hipervínculo', disabled: true },
    { icon: 'add_link', label: 'Vínculo a este rango', run: linkToRange }
  ], { x, y }, { cls: 'ctx' });
}
// Notas (comentarios) en celdas
async function editNote() {
  const cur0 = activeStyle().nt || '';
  const v = await dialog({ title: cur0 ? 'Editar nota' : 'Nueva nota', text: `Celda ${keyOf(S.sel.ar, S.sel.ac)} · ${esc(S.me.nombre)}:`, input: cur0 });
  focusGrid(); if (v == null) return;
  const k = keyOf(S.sel.ar, S.sel.ac), old = cellAt(S.sel.ar, S.sel.ac);
  write({ [`celdas/${S.sid}/${k}`]: cellObj(old?.v, { ...(old?.s || {}), nt: v.trim() ? `${S.me.nombre}: ${v.trim().replace(/^[^:]+:\s*/, '')}` : undefined }) });
}
// Formato de celdas (Ctrl+1)
async function formatCells() {
  const s = activeStyle();
  const opt = (arr, cur) => arr.map(([v, t]) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${t}</option>`).join('');
  const html = `<div class="fcgrid">
    <label>Número<select id="fcnf">${opt([['', 'General'], ['num', 'Número'], ['cur', 'Moneda (S/)'], ['usd', 'Dólares ($)'], ['pct', 'Porcentaje'], ['date', 'Fecha corta'], ['time', 'Hora'], ['text', 'Texto']], s.nf)}</select></label>
    <label>Decimales<input id="fcd" type="number" min="0" max="10" value="${s.d ?? ''}" placeholder="auto"></label>
    <label>Horizontal<select id="fca">${opt([['', 'General'], ['l', 'Izquierda'], ['c', 'Centro'], ['r', 'Derecha']], s.a)}</select></label>
    <label>Vertical<select id="fcva">${opt([['', 'Inferior'], ['m', 'Centro'], ['t', 'Superior']], s.va)}</select></label>
    <label>Tamaño de fuente<input id="fcfs" type="number" min="6" max="72" value="${s.fs || BASE_PT}"></label>
    <label>Bordes<select id="fcbd">${opt([['keep', 'Sin cambios'], ['all', 'Todos'], ['out', 'Externos'], ['none', 'Ninguno']], 'keep')}</select></label>
    <label class="fcchk"><input id="fcb" type="checkbox" ${s.b ? 'checked' : ''}> Negrita</label>
    <label class="fcchk"><input id="fci" type="checkbox" ${s.i ? 'checked' : ''}> Cursiva</label>
    <label class="fcchk"><input id="fcw" type="checkbox" ${s.w ? 'checked' : ''}> Ajustar texto</label>
  </div>`;
  const r = await dialog({ title: 'Formato de celdas', html, collect: d => ({
    nf: d.querySelector('#fcnf').value, d: d.querySelector('#fcd').value, a: d.querySelector('#fca').value, va: d.querySelector('#fcva').value,
    fs: +d.querySelector('#fcfs').value, bd: d.querySelector('#fcbd').value, b: d.querySelector('#fcb').checked, i: d.querySelector('#fci').checked, w: d.querySelector('#fcw').checked }) });
  focusGrid(); if (!r) return;
  styleSel(st => ({ ...st, nf: r.nf || undefined, d: r.d === '' ? undefined : Math.max(0, Math.min(10, +r.d)), a: r.a || undefined, va: r.va || undefined,
    fs: r.fs && r.fs !== BASE_PT ? r.fs : undefined, b: r.b ? 1 : undefined, i: r.i ? 1 : undefined, w: r.w ? 1 : undefined }));
  if (r.bd !== 'keep') borderSel(r.bd);
}
// Elegir de la lista desplegable (valores ya escritos en la columna)
function pickFromList() {
  const c = S.sel.ac, vals = new Set();
  for (const [k, cell] of Object.entries(cellsOf(S.sid))) {
    const p = parseKey(k); if (!p || p.c !== c || p.r === S.sel.ar || !cell.v || cell.v[0] === '=') continue;
    vals.add(cell.v.replace(/^'/, ''));
    if (vals.size > 300) break;
  }
  if (!vals.size) return toast('No hay otros valores en esta columna');
  const k = keyOf(S.sel.ar, S.sel.ac), rect = cellRect(S.sel.ar, S.sel.ac), gr = U.gc.getBoundingClientRect();
  menu([{ search: 'Buscar' }, ...[...vals].sort((a, b) => a.localeCompare(b, 'es')).map(v => ({ label: esc(v), run: () => setInput(S.sid, S.sel.ar, S.sel.ac, v) }))],
    { x: gr.left + rect.x, y: gr.top + rect.y + rect.h }, { cls: 'pick' });
  void k;
}
// Vínculo a este rango: copia un enlace que abre el libro en esta hoja y celda
async function linkToRange() {
  const url = `${location.origin}${location.pathname}#libro=${S.book}&hoja=${S.sid}&celda=${U.namebox.value}`;
  try { await navigator.clipboard.writeText(url); toast('Vínculo copiado: al abrirlo, va directo a ' + U.namebox.value, 'ok'); }
  catch { dialog({ title: 'Vínculo a este rango', input: url, cancel: null }); }
}
function fnMenu(at) {
  menu(FUNCTION_LIST.map(([n, d]) => ({ icon: 'function', label: n, hint: d, run: () => { if (S.editing) { insertAtCaret(n + '('); } else startEdit('=' + n + '(', 'edit'); } })), at);
}
function insertAtCaret(t) {
  const ed = U.ed, p = ed.selectionStart;
  ed.value = ed.value.slice(0, p) + t + ed.value.slice(ed.selectionEnd);
  ed.setSelectionRange(p + t.length, p + t.length); U.fx.value = ed.value; ed.focus(); placeEditor(); schedule();
}
const pasteFromButton = () => pasteMode('all');

// ================================================================== ARCHIVO (vista Backstage)
function backstage() {
  const d = document.createElement('div');
  d.className = 'backstage';
  const users = Object.values(S.others);
  d.innerHTML = `<aside><button class="bk-back">${'<span class="ms">arrow_back</span>'}</button>
    <button data-a="new"><span class="ms">note_add</span>Nuevo libro</button>
    <button data-a="open"><span class="ms">apps</span>Elegir otro libro</button>
    <button data-a="import"><span class="ms">upload_file</span>Importar Excel</button>
    <button data-a="xlsx"><span class="ms">download</span>Descargar .xlsx</button>
    <button data-a="csv"><span class="ms">csv</span>Descargar CSV</button>
    <button data-a="print"><span class="ms">print</span>Imprimir</button>
    <button data-a="share"><span class="ms">share</span>Compartir</button>
    <button data-a="install"><span class="ms">install_desktop</span>Instalar app</button>
    <button data-a="name"><span class="ms">badge</span>Mi nombre</button></aside>
    <main><h1>Información</h1>
      <div class="bk-card"><h2>${esc(S.tree.meta.nombre || 'Libro1')}</h2>
      <p>Código del libro: <b>${esc(S.book)}</b> · ${sortedSheets().length} hojas</p>
      <p>Guardado: <b>${store?.mode === 'firebase' ? 'Firebase (nube, tiempo real)' : 'Este navegador (modo local)'}</b></p>
      <p>Tu nombre: <b>${esc(S.me.nombre)}</b></p></div>
      <div class="bk-card"><h3>Personas conectadas (${users.length + 1})</h3>
      <ul class="bk-users"><li><i style="background:${S.me.color}"></i>${esc(S.me.nombre)} (tú)</li>${users.map(u => `<li><i style="background:${u.color}"></i>${esc(u.nombre)} — ${esc(S.tree.hojas[u.hoja]?.nombre || '')} ${u.ar != null ? keyOf(u.ar, u.ac) : ''}</li>`).join('')}</ul></div>
      <div class="bk-card"><h3>Libros del hotel</h3><p><b>PEDIDO BODEGAS 2024</b> y <b>PEDIDO DE COCINA 2024</b> se cargan solos en la nube la primera vez que alguien los abre. Usa "Elegir otro libro" para cambiar entre ellos.</p></div>
    </main>`;
  document.body.appendChild(d);
  const onEsc = e => { if (e.key === 'Escape') close(); };
  const close = () => { d.remove(); document.removeEventListener('keydown', onEsc, true); focusGrid(); };
  document.addEventListener('keydown', onEsc, true);
  d.querySelector('.bk-back').onclick = close;
  d.querySelectorAll('aside [data-a]').forEach(b => b.onclick = () => { close(); runCmd({ new: 'newBook', open: 'openBook', import: 'import', xlsx: 'exportXlsx', csv: 'exportCsv', print: 'print', share: 'share', install: 'install', name: 'myName' }[b.dataset.a]); });
}

// ================================================================== COMANDOS
const toggle = k => styleSel(s => ({ ...s, [k]: activeStyle()[k] ? undefined : 1 }));
const setA = (k, v) => styleSel(s => ({ ...s, [k]: activeStyle()[k] === v ? undefined : v }));
function decimals(d) {
  const s = activeStyle(), v = calc.value(S.sid, S.sel.ar, S.sel.ac);
  let cur0 = s.d;
  if (cur0 == null) cur0 = s.nf === 'pct' ? 0 : s.nf ? 2 : (typeof v === 'number' ? ((fmtGeneral(v).split('.')[1] || '').length) : 0);
  const nd = Math.max(0, Math.min(10, cur0 + d));
  styleSel(st => ({ ...st, d: nd }));
}
function zoom(z) {
  const gw = U.gw, cx = (gw.scrollLeft + gw.clientWidth / 2) / S.z, cy = (gw.scrollTop + gw.clientHeight / 2) / S.z;
  S.z = Math.max(0.25, Math.min(3, Math.round(z * 100) / 100));
  U.zoom.value = Math.round(S.z * 100); U.zoomv.textContent = Math.round(S.z * 100) + '%';
  geomDirty = true; geom();
  gw.scrollLeft = cx * S.z - gw.clientWidth / 2; gw.scrollTop = cy * S.z - gw.clientHeight / 2;
  schedule();
}
let deferredInstall = null;
const CMD = {
  undo, redo,
  save: () => toast(store?.mode === 'firebase' ? 'Todo se guarda automáticamente en la nube ☁' : 'Todo se guarda automáticamente en este navegador'),
  paste: pasteFromButton, cut: () => doCopy(true), copy: () => doCopy(false),
  pasteMenu: at => menu([{ title: 'Opciones de pegado:', icon: 'content_paste' }, { html: pasteIconsHtml(), bind: bindPaste }, '-', { icon: '', label: 'Pegado especial…', hint: 'Ctrl+Alt+V', sub: pasteSpecialItems }], at),
  painter: () => { S.painter = { ...activeStyle() }; U.gw.classList.add('painting'); toast('Selecciona las celdas donde copiar el formato'); },
  bold: () => toggle('b'), italic: () => toggle('i'), underline: () => toggle('u'),
  font: v => styleSel(s => ({ ...s, ff: v === 'Aptos Narrow' ? undefined : v })),
  size: v => styleSel(s => ({ ...s, fs: +v === BASE_PT ? undefined : +v })),
  grow: () => { const c = activeStyle().fs || BASE_PT; const n = SIZES.find(x => x > c) || c; styleSel(s => ({ ...s, fs: n })); },
  shrink: () => { const c = activeStyle().fs || BASE_PT; const n = [...SIZES].reverse().find(x => x < c) || c; styleSel(s => ({ ...s, fs: n })); },
  bordersMenu: at => menu([
    { icon: 'border_bottom', label: 'Borde inferior', run: () => borderSel('b') },
    { icon: 'border_top', label: 'Borde superior', run: () => borderSel('t') },
    { icon: 'border_left', label: 'Borde izquierdo', run: () => borderSel('l') },
    { icon: 'border_right', label: 'Borde derecho', run: () => borderSel('r') },
    '-',
    { icon: 'border_all', label: 'Todos los bordes', run: () => borderSel('all') },
    { icon: 'border_outer', label: 'Bordes externos', run: () => borderSel('out') },
    { icon: 'check_box_outline_blank', label: 'Borde de cuadro grueso', run: () => borderSel('thick') },
    { icon: 'border_clear', label: 'Sin borde', run: () => borderSel('none') }], at),
  fill: () => applyColor('fill', S.fillColor), fillMenu: at => colorMenu(at, 'fill'),
  color: () => applyColor('color', S.fontColor), colorMenu: at => colorMenu(at, 'color'),
  vtop: () => setA('va', 't'), vmid: () => setA('va', 'm'), vbot: () => setA('va', 'b'),
  left: () => setA('a', 'l'), center: () => setA('a', 'c'), right: () => setA('a', 'r'), wrap: () => toggle('w'),
  numfmt: v => styleSel(s => ({ ...s, nf: v || undefined, d: undefined })),
  fmtCur: () => styleSel(s => ({ ...s, nf: 'cur', d: undefined })), fmtPct: () => styleSel(s => ({ ...s, nf: 'pct', d: undefined })),
  fmtNum: () => styleSel(s => ({ ...s, nf: 'num', d: undefined })), decInc: () => decimals(1), decDec: () => decimals(-1),
  insertMenu: at => menu([
    { icon: 'table_rows', label: 'Insertar filas de hoja', run: insRows },
    { icon: 'view_week', label: 'Insertar columnas de hoja', run: insCols },
    { icon: 'note_add', label: 'Insertar hoja', run: () => addSheet() }], at),
  deleteMenu: at => menu([
    { icon: 'delete_sweep', label: 'Eliminar filas de hoja', run: delRows },
    { icon: 'delete', label: 'Eliminar columnas de hoja', run: delCols },
    { icon: 'tab_close', label: 'Eliminar hoja', run: () => deleteSheet(S.sid) }], at),
  formatMenu: at => menu([
    { icon: 'width', label: 'Autoajustar ancho de columna', run: () => { const R = rng(); for (let c = R.c1; c <= R.c2; c++) autofitCol(c); } },
    { icon: 'width_normal', label: 'Ancho de columna…', run: async () => { const v = await dialog({ title: 'Ancho de columna (píxeles)', input: cur().anchos?.['c' + S.sel.ac] ?? DEF_W }); const R = rng(); if (v && +v > 0) setSize('c', range(R.c1, R.c2), +v); focusGrid(); } },
    { icon: 'height', label: 'Alto de fila…', run: async () => { const v = await dialog({ title: 'Alto de fila (píxeles)', input: cur().altos?.['r' + S.sel.ar] ?? DEF_H }); const R = boundedSel(); if (v && +v > 0) setSize('r', range(R.r1, R.r2), +v); focusGrid(); } },
    '-',
    { icon: 'edit', label: 'Cambiar nombre de la hoja', run: () => renameSheet(S.sid) }], at),
  autosum: () => autoFn('SUMA'), fnPROMEDIO: () => autoFn('PROMEDIO'), fnCONTAR: () => autoFn('CONTAR'),
  fnMAX: () => autoFn('MAX'), fnMIN: () => autoFn('MIN'),
  fnSI: () => startEdit('=SI(', 'edit'), fnBUSCARV: () => startEdit('=BUSCARV(', 'edit'),
  clearMenu: at => menu([
    { icon: 'clear_all', label: 'Borrar todo', run: () => clearSel('all') },
    { icon: 'format_clear', label: 'Borrar formatos', run: () => clearSel('fmt') },
    { icon: 'ink_eraser', label: 'Borrar contenido', run: () => clearSel('content') }], at),
  sortMenu: at => menu([
    { icon: 'north', label: 'Ordenar de A a Z', run: () => sortSel(false) },
    { icon: 'south', label: 'Ordenar de Z a A', run: () => sortSel(true) }], at),
  sortAZ: () => sortSel(false), sortZA: () => sortSel(true),
  find, insRows, insCols, addSheet: () => addSheet(), template: insertTemplate,
  today: () => { const k = keyOf(S.sel.ar, S.sel.ac); write({ [`celdas/${S.sid}/${k}`]: cellObj(String(todaySerial()), { ...activeStyle(), nf: 'date' }) }); },
  now: () => { const k = keyOf(S.sel.ar, S.sel.ac); write({ [`celdas/${S.sid}/${k}`]: cellObj(String(nowSerial() % 1), { ...activeStyle(), nf: 'time' }) }); },
  fnMenu: at => fnMenu(at),
  showFormulas: () => { S.showF = !S.showF; dataDirty = true; schedule(); refreshRibbon(); },
  recalc: () => { calc.reset(); dataDirty = true; schedule(); toast('Recalculado'); },
  import: () => { U.file.dataset.mode = ''; U.file.click(); },
  syncFile: () => { U.file.dataset.mode = 'sync'; U.file.click(); },
  exportXlsx, exportCsv, print: printSheet,
  zoomIn: () => zoom(S.z + 0.1), zoomOut: () => zoom(S.z - 0.1), zoom100: () => zoom(1),
  grid: () => { S.grid = !S.grid; lsSet('xw-grid', S.grid ? '1' : '0'); U.gw.classList.toggle('nogrid', !S.grid); refreshRibbon(); },
  fullscreen: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); },
  install: async () => {
    if (deferredInstall) { deferredInstall.prompt(); const r = await deferredInstall.userChoice; if (r.outcome === 'accepted') toast('¡Instalada! Búscala en el escritorio o el menú Inicio.', 'ok'); deferredInstall = null; U.installBtn.hidden = true; }
    else if (matchMedia('(display-mode: standalone)').matches) toast('Ya estás usando la app instalada');
    else dialog({ title: 'Instalar en la computadora', html: '<p>En <b>Chrome</b> o <b>Edge</b>: pulsa el ícono <b>⊕ Instalar</b> que aparece a la derecha de la barra de direcciones, o abre el menú <b>⋮ → Transmitir, guardar y compartir → Instalar página como app</b>.</p><p>La app se abrirá en su propia ventana con el ícono del hotel.</p>', cancel: null });
  },
  share: async () => {
    const url = location.origin + location.pathname + '#libro=' + S.book;
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Envíalo a tus compañeros para editar juntos.', 'ok'); }
    catch { dialog({ title: 'Compartir', text: 'Copia este enlace:', input: url, cancel: null }); }
  },
  newBook: async () => {
    const n = (await dialog({ title: 'Nuevo libro', text: 'Nombre del libro:', input: 'Libro nuevo' }))?.trim(); if (!n) return focusGrid();
    const id = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
    lsSet('xw-book', id); location.hash = 'libro=' + id; lsSet('xw-newname:' + id, n); location.reload();
  },
  openBook: () => { location.hash = ''; },
  home: () => { location.hash = ''; },
  myName: async () => {
    const n = (await dialog({ title: 'Tu nombre', input: S.me.nombre }))?.trim(); if (!n) return focusGrid();
    S.me.nombre = n; lsSet('xw-nombre', n); onSel(); renderUsers(); focusGrid();
  },
  cancelEdit: () => cancel(), commitEdit: () => commit(0, 0),
  tabsLeft: () => { const l = sortedSheets(), i = l.findIndex(x => x[0] === S.sid); if (i > 0) switchSheet(l[i - 1][0]); },
  tabsRight: () => { const l = sortedSheets(), i = l.findIndex(x => x[0] === S.sid); if (i < l.length - 1) switchSheet(l[i + 1][0]); }
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function runCmd(name, arg, el) {
  const f = CMD[name]; if (!f) return;
  const keepsEdit = ['fnMenu', 'cancelEdit', 'commitEdit'].includes(name);
  if (name === 'home' || name === 'openBook') { if (S.editing) commit(0, 0); return f(); }
  if (S.editing && !keepsEdit) commit(0, 0);
  f(el || arg);
  if (!/Menu$/.test(name) && !['find', 'newBook', 'openBook', 'myName', 'install', 'share'].includes(name)) focusGrid();
}
function focusGrid() { U.ed.focus({ preventScroll: true }); }

function refreshRibbon() {
  const s = activeStyle();
  const on = (cmd, v) => document.querySelectorAll(`.ribbon [data-cmd="${cmd}"]`).forEach(b => b.classList.toggle('on', !!v));
  on('bold', s.b); on('italic', s.i); on('underline', s.u); on('wrap', s.w);
  on('left', s.a === 'l'); on('center', s.a === 'c'); on('right', s.a === 'r');
  on('vtop', s.va === 't'); on('vmid', s.va === 'm'); on('vbot', s.va === 'b' || !s.va);
  on('showFormulas', S.showF); on('grid', S.grid);
  const sf = document.querySelector('.ribbon [data-cmd="font"]'); if (sf) sf.value = s.ff || 'Aptos Narrow';
  const ss = document.querySelector('.ribbon [data-cmd="size"]'); if (ss) { if (![...ss.options].some(o => +o.value === (s.fs || BASE_PT))) ss.add(new Option(s.fs, s.fs)); ss.value = s.fs || BASE_PT; }
  const sn = document.querySelector('.ribbon [data-cmd="numfmt"]'); if (sn) sn.value = s.nf || '';
}

// ================================================================== INTERFAZ: EVENTOS
function hit(e) {
  const wr = U.gw.getBoundingClientRect();
  const vx = e.clientX - wr.left, vy = e.clientY - wr.top;
  const x = vx + U.gw.scrollLeft, y = vy + U.gw.scrollTop;
  return { vx, vy, x, y, inCol: vy < G.hh, inRow: vx < G.rhw, r: rowAt(Math.max(0, y - G.hh)), c: colAt(Math.max(0, x - G.rhw)) };
}
const POINT_CHARS = '=(+-*/^,;:&<>';
function canPoint() {
  if (!S.editing) return false;
  const el = document.activeElement === U.fx ? U.fx : U.ed;
  const v = el.value; if (v[0] !== '=') return false;
  if (S.point) return true;
  const ch = v.slice(0, el.selectionStart).trimEnd().slice(-1);
  return POINT_CHARS.includes(ch);
}
function pointRef(r1, c1, r2, c2) {
  const el = document.activeElement === U.fx ? U.fx : U.ed;
  const ref = (r1 === r2 && c1 === c2) ? keyOf(r1, c1) : `${keyOf(Math.min(r1, r2), Math.min(c1, c2))}:${keyOf(Math.max(r1, r2), Math.max(c1, c2))}`;
  const sheetPre = S.editing.sid !== S.sid ? '' : '';
  if (!S.point) S.point = { start: el.selectionStart, len: 0 };
  const v = el.value;
  el.value = v.slice(0, S.point.start) + sheetPre + ref + v.slice(S.point.start + S.point.len);
  S.point.len = (sheetPre + ref).length;
  const p = S.point.start + S.point.len; el.setSelectionRange(p, p);
  if (el === U.ed) U.fx.value = el.value; else U.ed.value = el.value;
  U.smode.textContent = 'Señalar';
  placeEditor(); schedule();
}

let drag = null, autoT = 0, lastMove = null;
function bindUI() {
  const { gw, gc, ed, fx, namebox, stabs, zoom: zr, file } = U;

  // ---- cinta
  document.querySelectorAll('.rtab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.tab === 'archivo') return backstage();
    document.querySelectorAll('.rtab').forEach(x => x.classList.toggle('on', x === t));
    document.querySelectorAll('.rpanel').forEach(p => p.classList.toggle('on', p.dataset.panel === t.dataset.tab));
    focusGrid();
  }));
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-cmd]'); if (!b) return;
    runCmd(b.dataset.cmd, null, /Menu$/.test(b.dataset.cmd) ? b : null);
  });
  document.querySelectorAll('button[data-cmd]').forEach(b => b.addEventListener('mousedown', e => { if (!b.closest('.titlebar')) e.preventDefault(); }));
  document.querySelectorAll('select[data-cmd]').forEach(s => s.addEventListener('change', () => runCmd(s.dataset.cmd, s.value)));
  U.bookName.addEventListener('click', async () => {
    const n = (await dialog({ title: 'Nombre del libro', input: S.tree.meta.nombre || 'Libro1' }))?.trim();
    if (n) write({ 'meta/nombre': n }); focusGrid();
  });
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    try {
      if (file.dataset.mode === 'sync') { toast('Comparando ' + f.name + ' con la nube…'); await loadXLSX(); await syncBook(await f.arrayBuffer(), libroById(S.book)); }
      else await importFile(f);
    } catch (e) { toast('No se pudo leer el archivo: ' + e.message, 'err'); }
  });

  // ---- scroll / tamaño
  gw.addEventListener('scroll', () => { schedule(); savePos(); }, { passive: true });
  window.addEventListener('pagehide', () => savePos(true));
  new ResizeObserver(schedule).observe(gw);
  gw.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoom(S.z * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
  zr.addEventListener('input', () => zoom(zr.value / 100));

  // ---- ratón en la cuadrícula
  gc.addEventListener('mousedown', e => {
    if (!G || e.button === 1) return;
    if (e.target === ed && S.editing) return;
    const h = hit(e);
    if (e.button === 2) {
      const R = rng();
      if (!h.inCol && !h.inRow && !(h.r >= R.r1 && h.r <= R.r2 && h.c >= R.c1 && h.c <= R.c2)) { if (S.editing) commit(0, 0); select(h.r, h.c, h.r, h.c, false); }
      return;
    }
    e.preventDefault();
    if (e.target.dataset.fill) { drag = { type: 'fill', src: rng() }; return; }
    // modo señalar (escribiendo una fórmula)
    if (S.editing && !h.inCol && !h.inRow && canPoint()) {
      drag = { type: 'point', r: h.r, c: h.c }; pointRef(h.r, h.c, h.r, h.c);
      return;
    }
    if (S.editing) commit(0, 0);
    ed.focus({ preventScroll: true });
    if (h.inCol && h.inRow) { select(0, 0, G.nr - 1, G.nc - 1, false); return; }
    if (h.inCol) {
      const bx = h.x - G.rhw;
      for (const c of [h.c, h.c - 1]) if (c >= 0 && Math.abs(bx - G.colX[c + 1]) <= 4) {
        if (e.detail === 2) { autofitCol(c); return; }
        drag = { type: 'rc', c, start: e.clientX, w0: G.colX[c + 1] - G.colX[c] }; return;
      }
      if (e.shiftKey) select(0, S.sel.ac, G.nr - 1, h.c, false); else select(0, h.c, G.nr - 1, h.c, false);
      drag = { type: 'col', c: h.c }; return;
    }
    if (h.inRow) {
      const by = h.y - G.hh;
      for (const r of [h.r, h.r - 1]) if (r >= 0 && Math.abs(by - G.rowY[r + 1]) <= 3) {
        if (e.detail === 2) { setSize('r', [r], null); return; }
        drag = { type: 'rr', r, start: e.clientY, h0: G.rowY[r + 1] - G.rowY[r] }; return;
      }
      if (e.shiftKey) select(S.sel.ar, 0, h.r, G.nc - 1, false); else select(h.r, 0, h.r, G.nc - 1, false);
      drag = { type: 'row', r: h.r }; return;
    }
    if (e.shiftKey) select(S.sel.ar, S.sel.ac, h.r, h.c, false);
    else select(h.r, h.c, h.r, h.c, false);
    drag = { type: 'sel' };
  });
  gc.addEventListener('dblclick', e => {
    const h = hit(e); if (h.inCol || h.inRow || e.target.dataset.fill) return;
    select(h.r, h.c, h.r, h.c, false); startEdit(null, 'edit');
  });
  gc.addEventListener('mousemove', e => {
    if (drag || !G) return;
    const h = hit(e);
    let cur0 = '';
    if (h.inCol && !h.inRow) { const bx = h.x - G.rhw; if (Math.abs(bx - G.colX[h.c + 1]) <= 4 || (h.c > 0 && Math.abs(bx - G.colX[h.c]) <= 4)) cur0 = 'col-resize'; }
    else if (h.inRow && !h.inCol) { const by = h.y - G.hh; if (Math.abs(by - G.rowY[h.r + 1]) <= 3 || (h.r > 0 && Math.abs(by - G.rowY[h.r]) <= 3)) cur0 = 'row-resize'; }
    gc.style.cursor = cur0;
  });
  gc.addEventListener('contextmenu', e => {
    e.preventDefault(); if (!G) return;
    const h = hit(e);
    if (h.inCol && !h.inRow) return menu([
      { icon: 'view_week', label: 'Insertar columnas', run: insCols }, { icon: 'delete', label: 'Eliminar columnas', run: delCols },
      { icon: 'width', label: 'Autoajustar ancho', run: () => { const R = rng(); for (let c = R.c1; c <= R.c2; c++) autofitCol(c); } }], { x: e.clientX, y: e.clientY });
    if (h.inRow && !h.inCol) return menu([
      { icon: 'table_rows', label: 'Insertar filas', run: insRows }, { icon: 'delete_sweep', label: 'Eliminar filas', run: delRows }], { x: e.clientX, y: e.clientY });
    cellMenu(e.clientX, e.clientY);
  });
  const onMove = e => {
    if (!drag || !G) return;
    lastMove = e;
    const h = hit(e);
    if (drag.type === 'rc') { const w = Math.max(8, drag.w0 + e.clientX - drag.start); drag.w = w / S.z; const sh = cur(); sh.anchos = { ...(sh.anchos || {}), ['c' + drag.c]: Math.round(w / S.z) }; geomDirty = true; schedule(); return; }
    if (drag.type === 'rr') { const hh = Math.max(6, drag.h0 + e.clientY - drag.start); drag.h = hh / S.z; const sh = cur(); sh.altos = { ...(sh.altos || {}), ['r' + drag.r]: Math.round(hh / S.z) }; geomDirty = true; schedule(); return; }
    if (drag.type === 'sel') select(S.sel.ar, S.sel.ac, h.r, h.c, false);
    else if (drag.type === 'col') select(0, drag.c, G.nr - 1, h.c, false);
    else if (drag.type === 'row') select(drag.r, 0, h.r, G.nc - 1, false);
    else if (drag.type === 'point') pointRef(drag.r, drag.c, h.r, h.c);
    else if (drag.type === 'fill') {
      const s = drag.src; let d = { ...s };
      const dr = h.r > s.r2 ? h.r - s.r2 : h.r < s.r1 ? h.r - s.r1 : 0, dc = h.c > s.c2 ? h.c - s.c2 : h.c < s.c1 ? h.c - s.c1 : 0;
      if (Math.abs(dr) >= Math.abs(dc) && dr) { if (dr > 0) d.r2 = h.r; else d.r1 = h.r; }
      else if (dc) { if (dc > 0) d.c2 = h.c; else d.c1 = h.c; }
      S.fillPrev = d; drag.dst = d; schedule();
    }
    // desplazamiento automático
    const wr = gw.getBoundingClientRect();
    const out = e.clientY > wr.bottom - 10 || e.clientY < wr.top + G.hh || e.clientX > wr.right - 10 || e.clientX < wr.left + G.rhw;
    if (out && !autoT) autoT = setInterval(() => {
      if (!drag || !lastMove) return;
      const r = gw.getBoundingClientRect();
      if (lastMove.clientY > r.bottom - 10) gw.scrollTop += 20; else if (lastMove.clientY < r.top + G.hh) gw.scrollTop -= 20;
      if (lastMove.clientX > r.right - 10) gw.scrollLeft += 20; else if (lastMove.clientX < r.left + G.rhw) gw.scrollLeft -= 20;
      onMove(lastMove);
    }, 40);
    if (!out && autoT) { clearInterval(autoT); autoT = 0; }
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    clearInterval(autoT); autoT = 0;
    const d = drag; drag = null;
    if (d.type === 'rc' && d.w) { const R = rng(); const full = R.r1 === 0 && R.r2 >= G.nr - 1 && d.c >= R.c1 && d.c <= R.c2; setSize('c', full ? range(R.c1, R.c2) : [d.c], d.w); }
    if (d.type === 'rr' && d.h) { const R = rng(); const full = R.c1 === 0 && R.c2 >= G.nc - 1 && d.r >= R.r1 && d.r <= R.r2; setSize('r', full ? range(R.r1, R.r2) : [d.r], d.h); }
    if (d.type === 'fill') { S.fillPrev = null; if (d.dst) doFill(d.src, d.dst); schedule(); }
    if (d.type === 'point') { (document.activeElement === fx ? fx : ed).focus(); return; }
    if (S.painter && (d.type === 'sel' || d.type === 'col' || d.type === 'row')) { const p = S.painter; S.painter = null; gw.classList.remove('painting'); styleSel(() => ({ ...p })); }
  });

  // ---- teclado
  ed.addEventListener('input', () => {
    if (!S.editing) { const v = ed.value; startEdit(v, 'enter'); ed.value = v; ed.setSelectionRange(v.length, v.length); }
    S.point = null;
    fx.value = ed.value; placeEditor(); schedule();
  });
  ed.addEventListener('keydown', e => onKey(e, 'cell'));
  fx.addEventListener('keydown', e => onKey(e, 'bar'));
  fx.addEventListener('focus', () => { if (!S.editing) { startEdit(null, 'edit', 'bar'); } });
  fx.addEventListener('input', () => { if (!S.editing) startEdit(fx.value, 'edit', 'bar'); S.point = null; ed.value = fx.value; placeEditor(); schedule(); });
  ed.addEventListener('copy', e => { if (!S.editing) doCopy(false, e); });
  ed.addEventListener('cut', e => { if (!S.editing) doCopy(true, e); });
  ed.addEventListener('paste', e => { if (S.editing) return; e.preventDefault(); doPaste(e.clipboardData.getData('text/plain'), e.clipboardData.getData('text/html')); });

  namebox.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    if (e.key === 'Enter') {
      let t = namebox.value.trim().toUpperCase(), sid = S.sid;
      const m0 = /^(.+)!(.+)$/.exec(t); if (m0) { const s = model.sheetIdByName(m0[1].replace(/^'|'$/g, '')); if (s) { sid = s; t = m0[2]; } }
      const m = /^([A-Z]+\d+)(?::([A-Z]+\d+))?$/.exec(t);
      if (m) { if (sid !== S.sid) switchSheet(sid); if (geomDirty || !G) geom(); const a = parseKey(m[1]), b = parseKey(m[2] || m[1]); select(a.r, a.c, b.r, b.c); }
      else toast('Referencia no válida', 'err');
    }
    focusGrid();
  });
  namebox.addEventListener('focus', () => namebox.select());

  // ---- pestañas de hojas
  stabs.addEventListener('click', e => { const t = e.target.closest('.stab'); if (t && t.dataset.sid !== S.sid) switchSheet(t.dataset.sid); focusGrid(); });
  stabs.addEventListener('dblclick', e => { const t = e.target.closest('.stab'); if (t) renameSheet(t.dataset.sid); });
  stabs.addEventListener('contextmenu', e => {
    const t = e.target.closest('.stab'); e.preventDefault(); if (!t) return;
    const sid = t.dataset.sid; if (sid !== S.sid) switchSheet(sid);
    menu([{ icon: 'note_add', label: 'Insertar hoja', run: () => addSheet() }, { icon: 'edit', label: 'Cambiar nombre', run: () => renameSheet(sid) },
      { icon: 'arrow_back', label: 'Mover a la izquierda', run: () => moveSheet(sid, -1) }, { icon: 'arrow_forward', label: 'Mover a la derecha', run: () => moveSheet(sid, 1) },
      '-', { icon: 'delete', label: 'Eliminar', run: () => deleteSheet(sid) }], { x: e.clientX, y: e.clientY - 10 });
  });
  stabs.addEventListener('wheel', e => { stabs.scrollLeft += e.deltaY; }, { passive: true });
}

function onKey(e, src) {
  const ctrl = e.ctrlKey || e.metaKey, k = e.key;
  if (S.editing) {
    if (k === 'Enter' && e.altKey && src === 'cell') { e.preventDefault(); insertAtCaret('\n'); return; }
    if (k === 'Enter') { e.preventDefault(); commit(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'Tab') { e.preventDefault(); commit(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Escape') { e.preventDefault(); cancel(); return; }
    if (k === 'F2') { e.preventDefault(); S.editing.mode = S.editing.mode === 'enter' ? 'edit' : 'enter'; U.smode.textContent = S.editing.mode === 'enter' ? 'Introducir' : 'Modificar'; return; }
    if (k.startsWith('Arrow') && S.editing.mode === 'enter' && src === 'cell' && U.ed.value[0] !== '=') {
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      commit(d[0], d[1]);
    }
    return;
  }
  if (src === 'bar') return;
  const nav = e.altKey ? null : { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
  if (nav) { e.preventDefault(); move(nav[0], nav[1], e.shiftKey, ctrl); return; }
  if (k === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return; }
  if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
  if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); const n = Math.max(1, Math.floor(U.gw.clientHeight / (DEF_H * S.z)) - 1); move(k === 'PageDown' ? n : -n, 0, e.shiftKey); return; }
  if (k === 'Home') { e.preventDefault(); if (ctrl) select(0, 0); else select(S.sel.ar, 0); return; }
  if (k === 'End' && ctrl) { e.preventDefault(); const x = model.extent(S.sid); select(Math.max(0, x.r), Math.max(0, x.c)); return; }
  if (k === 'F2') { e.preventDefault(); startEdit(null, 'edit'); return; }
  if (k === 'Delete') { e.preventDefault(); clearSel('content'); return; }
  if (k === 'Backspace') { e.preventDefault(); startEdit('', 'enter'); return; }
  if (k === 'Escape') { S.clip = null; S.painter = null; U.gw.classList.remove('painting'); schedule(); return; }
  if (e.altKey && (k === '=' || k === '+')) { e.preventDefault(); autoFn('SUMA'); return; }
  if (e.altKey && k === 'ArrowDown') { e.preventDefault(); pickFromList(); return; }
  if (ctrl && e.altKey && k.toLowerCase() === 'v') { e.preventDefault(); const r = cellRect(S.sel.ar, S.sel.ac), g = U.gc.getBoundingClientRect(); menu(pasteSpecialItems(), { x: g.left + r.x + r.w, y: g.top + r.y }); return; }
  if (ctrl && k === '1') { e.preventDefault(); formatCells(); return; }
  if (ctrl) {
    const l = k.toLowerCase();
    const map = { z: undo, y: redo, b: CMD.bold, n: CMD.bold, i: CMD.italic, k: CMD.italic, u: CMD.underline, f: find, s: CMD.save, p: printSheet, d: () => fillDir('d'), r: () => fillDir('r'), a: () => select(0, 0, G.nr - 1, G.nc - 1, false), '`': CMD.showFormulas, ';': CMD.today, '+': () => zoom(S.z + .1), '-': () => zoom(S.z - .1) };
    if (l === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
    if (map[l]) { e.preventDefault(); map[l](); return; }
  }
}
function fillDir(dir) {
  const R = rng();
  if (dir === 'd' && R.r2 > R.r1) doFill({ ...R, r2: R.r1 }, R);
  if (dir === 'r' && R.c2 > R.c1) doFill({ ...R, c2: R.c1 }, R);
}

// ================================================================== TÍTULO, USUARIOS, NUBE, AVISOS
function updateTitle() {
  const n = S.tree.meta.nombre || libroById(S.book)?.nombre || lsGet('xw-newname:' + S.book) || 'Libro1';
  if (!S.tree.meta.nombre && S.ready && lsGet('xw-newname:' + S.book)) write({ 'meta/nombre': n }, false);
  U.bookName.textContent = n;
  document.title = `${n} - Excel`;
}
function renderUsers() {
  const list = [{ ...S.me, me: true }, ...Object.values(S.others)];
  const seen = new Set();
  U.users.innerHTML = list.filter(u => { const k = u.nombre + u.color; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8).map(u => {
    const ini = (u.nombre || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const where = u.me ? 'Tú' : `${S.tree.hojas[u.hoja]?.nombre || ''} ${u.ar != null ? keyOf(u.ar, u.ac) : ''}`;
    return `<span class="av" style="background:${u.color}" title="${esc(u.nombre)} — ${esc(where)}" data-h="${u.hoja || ''}" data-r="${u.ar ?? ''}" data-c="${u.ac ?? ''}">${esc(ini)}</span>`;
  }).join('');
  U.users.querySelectorAll('.av').forEach(a => a.onclick = () => {
    if (!a.dataset.h || a.dataset.r === '') return;
    if (a.dataset.h !== S.sid && S.tree.hojas[a.dataset.h]) switchSheet(a.dataset.h);
    setTimeout(() => select(+a.dataset.r, +a.dataset.c), 0);
  });
  const n = Object.keys(S.others).length;
  U.sinfo.textContent = n ? `${n + 1} personas editando` : '';
}
function setCloud(st) {
  const el = U.cloud;
  let icon = 'cloud_done', t = 'Guardado', cls = 'ok';
  if (st.mode === 'error') { icon = 'cloud_off'; t = 'Error de conexión'; cls = 'err'; }
  else if (st.mode === 'local') { icon = 'save'; t = 'Guardado en este equipo'; cls = 'local'; }
  else if (!st.connected) { icon = 'cloud_off'; t = 'Sin conexión · se guardará al volver'; cls = 'warn'; }
  else if (st.pending > 0) { icon = 'cloud_sync'; t = 'Guardando…'; cls = 'sync'; }
  el.className = 'cloud ' + cls;
  el.innerHTML = `<span class="ms">${icon}</span><span>${t}</span>`;
}
function toast(msg, kind = 'info', ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  U.toasts.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

// ================================================================== FAVICON E INSTALACIÓN (PWA)
function setupFavicon() {
  // Usa la foto del hotel (img/hotel.jpg) como ícono de la pestaña si existe
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), s = Math.min(img.width, img.height);
    g.beginPath(); g.roundRect ? g.roundRect(0, 0, 64, 64, 14) : g.rect(0, 0, 64, 64); g.clip();
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64);
    g.fillStyle = '#217346'; g.fillRect(36, 36, 28, 28);
    g.fillStyle = '#fff'; g.font = 'bold 24px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('X', 50, 51);
    let link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = c.toDataURL('image/png');
  };
  img.src = 'img/hotel.jpg';
}
function setupPWA() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Cuando se publica una versión nueva, la página se recarga sola una vez para usarla
    const had = !!navigator.serviceWorker.controller; let done = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !done && !S.editing) { done = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; U.installBtn.hidden = false; });
  window.addEventListener('appinstalled', () => { U.installBtn.hidden = true; toast('App instalada en tu computadora', 'ok'); });
}
