// =====================================================================
//  Almacenamiento en tiempo real: Firebase Realtime Database
//  (o modo local con localStorage + BroadcastChannel si no hay config)
//
//  Estructura:  libros/{libro}/meta            { nombre }
//               libros/{libro}/hojas/{hoja}    { nombre, orden, anchos{cN}, altos{rN} }
//               libros/{libro}/celdas/{hoja}/{A1}  { v: "texto o =fórmula", s: {estilo} }
//               libros/{libro}/presencia/{id}  { nombre, color, hoja, r, c, r2, c2 }
// =====================================================================
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
export const usingFirebase = () => !!(firebaseConfig && firebaseConfig.apiKey && (firebaseConfig.databaseURL || firebaseConfig.projectId));

const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
export function getIn(obj, path) {
  let o = obj;
  for (const p of path.split('/')) { if (o == null) return null; o = o[p]; }
  return o === undefined ? null : o;
}
function setIn(obj, path, val) {
  const ps = path.split('/'), stack = [];
  let o = obj;
  for (let i = 0; i < ps.length - 1; i++) {
    if (o[ps[i]] == null || typeof o[ps[i]] !== 'object') { if (val == null) return; o[ps[i]] = {}; }
    stack.push([o, ps[i]]); o = o[ps[i]];
  }
  const last = ps[ps.length - 1];
  if (val == null) delete o[last]; else o[last] = clone(val);
  for (let i = stack.length - 1; i >= 0; i--) {
    const [p, k] = stack[i];
    if (p[k] && typeof p[k] === 'object' && !Object.keys(p[k]).length) delete p[k]; else break;
  }
}
const randomId = () => Math.random().toString(36).slice(2, 10);

export async function createStore(book, h) {
  return usingFirebase() ? firebaseStore(book, h) : localStore(book, h);
}

// Emite eventos finos (meta / hoja / celda) para las rutas modificadas
function emitFor(tree, oldTree, paths, h) {
  const sheets = new Set(), cells = [], sheetCells = new Set(); let meta = false;
  for (const p of paths) {
    const ps = p.split('/');
    if (ps[0] === 'meta') meta = true;
    else if (ps[0] === 'hojas') { if (ps[1]) sheets.add(ps[1]); else Object.keys({ ...oldTree.hojas, ...tree.hojas }).forEach(s => sheets.add(s)); }
    else if (ps[0] === 'celdas') {
      if (ps[2]) cells.push([ps[1], ps[2]]);
      else if (ps[1]) sheetCells.add(ps[1]);
      else Object.keys({ ...oldTree.celdas, ...tree.celdas }).forEach(s => sheetCells.add(s));
    }
  }
  if (meta) h.onMeta(clone(tree.meta) || {});
  for (const s of sheets) h.onSheet(s, clone(getIn(tree, 'hojas/' + s)));
  for (const s of sheetCells) {
    const a = (oldTree.celdas || {})[s] || {}, b = (tree.celdas || {})[s] || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) h.onCell(s, k, clone(b[k]));
  }
  for (const [s, k] of cells) h.onCell(s, k, clone(getIn(tree, `celdas/${s}/${k}`)));
}

// ---------------------------------------------------------------- LOCAL
function localStore(book, h) {
  const KEY = 'excelweb:' + book;
  const me = 'local-' + randomId();
  let tree = {};
  try { tree = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { tree = {}; }
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  const peers = {};
  let myPres = null, warned = false;

  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(tree)); }
    catch { if (!warned) { warned = true; h.onError('El navegador no tiene más espacio. Configura Firebase para guardar libros grandes.'); } }
  };
  const apply = (updates, save) => {
    const oldTree = { hojas: { ...tree.hojas }, celdas: { ...tree.celdas }, meta: tree.meta };
    for (const [p, v] of Object.entries(updates)) setIn(tree, p, v);
    if (save) persist();
    emitFor(tree, oldTree, Object.keys(updates), h);
  };
  const prune = () => {
    const now = Date.now();
    for (const [id, p] of Object.entries(peers)) if (now - p.ts > 12000) { delete peers[id]; h.onPresence(id, null); }
  };
  if (bc) bc.onmessage = ({ data }) => {
    if (data.t === 'upd') apply(data.u, false);
    else if (data.t === 'pres') {
      if (data.v) { peers[data.id] = { ts: Date.now() }; h.onPresence(data.id, data.v); }
      else { delete peers[data.id]; h.onPresence(data.id, null); }
    } else if (data.t === 'hello' && myPres) bc.postMessage({ t: 'pres', id: me, v: myPres });
  };
  setInterval(() => { if (bc && myPres) bc.postMessage({ t: 'pres', id: me, v: myPres }); prune(); }, 4000);
  window.addEventListener('pagehide', () => { if (bc) bc.postMessage({ t: 'pres', id: me, v: null }); });

  setTimeout(() => {
    const all = ['meta', 'hojas', 'celdas'];
    emitFor(tree, { hojas: {}, celdas: {} }, all, h);
    h.onReady();
    h.onStatus({ mode: 'local', connected: true, pending: 0 });
    if (bc) bc.postMessage({ t: 'hello' });
  });

  return {
    id: me, mode: 'local',
    write(updates) {
      apply(updates, true);
      if (bc) bc.postMessage({ t: 'upd', u: updates });
      return Promise.resolve();
    },
    presence(v) { myPres = v; if (bc) bc.postMessage({ t: 'pres', id: me, v }); },
    watch(sid) { setTimeout(() => h.onLoaded(sid)); },
    pending: () => 0
  };
}

// ------------------------------------------------------------- FIREBASE
async function firebaseStore(book, h) {
  const [appM, dbM, authM] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-database.js'), import(SDK + 'firebase-auth.js')
  ]);
  const { ref, child, onValue, onChildAdded, onChildChanged, onChildRemoved, update, set, onDisconnect, serverTimestamp } = dbM;
  const cfg = { ...firebaseConfig, databaseURL: firebaseConfig.databaseURL || `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com` };
  const app = appM.initializeApp(cfg);
  const auth = authM.getAuth(app);
  let user;
  try { user = (await authM.signInAnonymously(auth)).user; }
  catch (e) { h.onError('No se pudo iniciar sesión en Firebase. Habilita el acceso "Anónimo" en Authentication. (' + e.code + ')'); throw e; }
  const db = dbM.getDatabase(app);
  const root = ref(db, 'libros/' + book);
  const me = user.uid + '-' + randomId();
  const OUTBOX = 'excelweb-outbox:' + book;
  let connected = false, pending = 0, myPres = null;
  const status = () => h.onStatus({ mode: 'firebase', connected, pending });
  let everConnected = false;
  setTimeout(() => {
    if (!everConnected) h.onError('No se pudo conectar con Firebase Realtime Database. En la consola de Firebase entra a Compilación → Realtime Database → Crear base de datos, y revisa que "databaseURL" en js/firebase-config.js sea la que aparece allí.');
  }, 15000);

  // Cola de cambios pendientes: si se cierra la página sin conexión, se reenvían al volver.
  let outbox = [];
  try { outbox = JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { outbox = []; }
  const saveOutbox = () => { try { localStorage.setItem(OUTBOX, JSON.stringify(outbox)); } catch { /* sin espacio */ } };
  const send = (id, updates) => {
    pending++; status();
    const done = () => { const n = outbox.length; outbox = outbox.filter(x => x.id !== id); if (outbox.length !== n) saveOutbox(); };
    return update(root, updates).then(done).catch(e => {
      done();
      h.onError('Firebase rechazó un cambio: ' + (e.code || e.message) + '. Revisa las reglas de la base de datos.');
    }).finally(() => { pending--; status(); });
  };

  const presRef = child(root, 'presencia/' + me);
  onValue(ref(db, '.info/connected'), s => {
    connected = !!s.val(); if (connected) everConnected = true; status();
    if (connected) {
      onDisconnect(presRef).remove();
      if (myPres) set(presRef, { ...myPres, ts: serverTimestamp() });
    }
  });

  onValue(child(root, 'meta'), s => h.onMeta(s.val() || {}));

  // Lecturas eficientes: solo se descargan las celdas de las hojas que se abren
  // (y de las que usan sus fórmulas). Después llegan solo los cambios.
  const hojas = child(root, 'hojas');
  const cellSubs = {};
  const watchCells = sid => {
    if (cellSubs[sid]) return;
    const cr = child(root, 'celdas/' + sid);
    cellSubs[sid] = [
      onChildAdded(cr, s => h.onCell(sid, s.key, s.val())),
      onChildChanged(cr, s => h.onCell(sid, s.key, s.val())),
      onChildRemoved(cr, s => h.onCell(sid, s.key, null))
    ];
    onValue(cr, () => h.onLoaded(sid), { onlyOnce: true });
  };
  onChildAdded(hojas, s => h.onSheet(s.key, s.val()));
  onChildChanged(hojas, s => h.onSheet(s.key, s.val()));
  onChildRemoved(hojas, s => { (cellSubs[s.key] || []).forEach(u => u()); delete cellSubs[s.key]; h.onSheet(s.key, null); });
  onValue(hojas, () => h.onReady(), { onlyOnce: true });

  const pres = child(root, 'presencia');
  onChildAdded(pres, s => { if (s.key !== me) h.onPresence(s.key, s.val()); });
  onChildChanged(pres, s => { if (s.key !== me) h.onPresence(s.key, s.val()); });
  onChildRemoved(pres, s => h.onPresence(s.key, null));

  for (const item of outbox) send(item.id, item.updates);

  window.addEventListener('beforeunload', e => { if (pending > 0) { e.preventDefault(); e.returnValue = ''; } });

  return {
    id: me, mode: 'firebase',
    write(updates) {
      const id = randomId();
      const json = JSON.stringify(updates);
      if (json.length < 200000) { outbox.push({ id, updates }); saveOutbox(); }
      return send(id, updates);
    },
    presence(v) {
      if (myPres && JSON.stringify(myPres) === JSON.stringify(v)) return;
      myPres = v; if (connected) set(presRef, { ...v, ts: serverTimestamp() });
    },
    watch: watchCells,
    pending: () => pending
  };
}
