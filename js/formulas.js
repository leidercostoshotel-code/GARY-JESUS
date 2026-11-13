// =====================================================================
//  Motor de fórmulas estilo Excel (español e inglés, separador , o ;)
// =====================================================================

export class FErr {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const E = {
  DIV0: new FErr('#DIV/0!'), VALUE: new FErr('#VALUE!'), REF: new FErr('#REF!'),
  NAME: new FErr('#NAME?'), NA: new FErr('#N/A'), NUM: new FErr('#NUM!'),
  CIRC: new FErr('#CIRC!'), ERROR: new FErr('#ERROR!'), NULL: new FErr('#NULL!')
};
const ERR_BY_CODE = Object.fromEntries(Object.values(E).map(e => [e.code, e]));

// ---------- utilidades de celdas ----------
export const colName = c => {
  let s = ''; c++;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
};
export const colIndex = s => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export const keyOf = (r, c) => colName(c) + (r + 1);
const KEY_RE = /^([A-Z]+)(\d+)$/;
const keyCache = new Map();
export const parseKey = k => {
  let p = keyCache.get(k);
  if (p === undefined) {
    const m = KEY_RE.exec(k);
    p = m ? { c: colIndex(m[1]), r: +m[2] - 1 } : null;
    if (keyCache.size > 200000) keyCache.clear();
    keyCache.set(k, p);
  }
  return p;
};
export const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

// ---------- fechas (número de serie de Excel) ----------
const EPOCH = Date.UTC(1899, 11, 30);
export const serialToDate = n => new Date(EPOCH + Math.round(n * 86400000));
export const todaySerial = () => { const d = new Date(); return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000; };
export const nowSerial = () => { const d = new Date(); return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCH) / 86400000; };
export function parseDate(t) {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t);
  if (!m) return null;
  let d = +m[1], mo = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return (Date.UTC(y, mo - 1, d) - EPOCH) / 86400000;
}
const pad = n => String(n).padStart(2, '0');
export const fmtDate = n => { const d = serialToDate(n); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
export const fmtTime = n => { const d = serialToDate(n); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

// ---------- literal (texto escrito en la celda) ----------
export function literal(raw) {
  if (raw == null || raw === '') return null;
  if (raw[0] === "'") return raw.slice(1);
  const t = raw.trim();
  if (NUM_RE.test(t)) return parseFloat(t);
  const u = t.toUpperCase();
  if (u === 'TRUE' || u === 'VERDADERO') return true;
  if (u === 'FALSE' || u === 'FALSO') return false;
  if (ERR_BY_CODE[u]) return ERR_BY_CODE[u];
  return raw;
}

// ---------- tokenizador ----------
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_À-ɏ][\w.À-ɏ]*))!`;
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const RE_REF = new RegExp(`^(?:${SHEET})?(${CELL}(?::${CELL})?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3})`);
const RE_NUM = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/;
const RE_ID = /^[A-Za-z_À-ɏ][\w.À-ɏ]*/;
const RE_ERR = /^#(DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!|CIRC!|ERROR!)/i;
const RE_OP = /^(<>|<=|>=|[-+*/^&=<>%(),;:])/;

export function tokenize(s) {
  const t = []; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') { i++; continue; }
    const rest = s.slice(i); let m;
    if (ch === '"') {
      let j = i + 1, v = '';
      for (;;) {
        if (j >= s.length) throw E.ERROR;
        if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue; } break; }
        v += s[j++];
      }
      t.push({ k: 'str', v, p: i, e: j + 1 }); i = j + 1; continue;
    }
    if ((m = RE_NUM.exec(rest))) { t.push({ k: 'num', v: parseFloat(m[0]), p: i, e: i + m[0].length }); i += m[0].length; continue; }
    if ((m = RE_REF.exec(rest))) {
      const after = rest.slice(m[0].length);
      if (!/^\s*\(/.test(after) && !/^[\w.]/.test(after)) {
        const sheet = m[1] != null ? m[1].replace(/''/g, "'") : (m[2] || null);
        t.push({ k: 'ref', text: m[0], sheet, ref: m[3], p: i, e: i + m[0].length });
        i += m[0].length; continue;
      }
    }
    if ((m = RE_ID.exec(rest))) { t.push({ k: 'id', v: m[0].toUpperCase(), p: i, e: i + m[0].length }); i += m[0].length; continue; }
    if ((m = RE_ERR.exec(rest))) { t.push({ k: 'err', v: ERR_BY_CODE[m[0].toUpperCase()] || E.ERROR, p: i, e: i + m[0].length }); i += m[0].length; continue; }
    if ((m = RE_OP.exec(rest))) { t.push({ k: 'op', v: m[0], p: i, e: i + m[0].length }); i += m[0].length; continue; }
    throw E.ERROR;
  }
  return t;
}

// ---------- referencias ----------
const CELL_PART = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const COL_PART = /^(\$?)([A-Za-z]{1,3})$/;
function parseRefPart(p) {
  let m = CELL_PART.exec(p);
  if (m) return { c: colIndex(m[2]), r: +m[4] - 1, ac: !!m[1], ar: !!m[3] };
  m = COL_PART.exec(p);
  if (m) return { c: colIndex(m[2]), r: null, ac: !!m[1], ar: false };
  return null;
}
const fmtPart = p => p.r === null ? (p.ac ? '$' : '') + colName(p.c) : (p.ac ? '$' : '') + colName(p.c) + (p.ar ? '$' : '') + (p.r + 1);
export function quoteSheet(name) {
  return /^[A-Za-z_À-ɏ][\w.À-ɏ]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name)
    ? name : "'" + name.replace(/'/g, "''") + "'";
}
function refNode(tk) {
  const parts = tk.ref.split(':').map(parseRefPart);
  if (parts.length === 1) return { t: 'ref', sheet: tk.sheet, c: parts[0].c, r: parts[0].r };
  const [a, b] = parts;
  if (a.r === null) return { t: 'range', sheet: tk.sheet, c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c), r1: 0, r2: Infinity };
  return { t: 'range', sheet: tk.sheet, r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r), c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c) };
}

// ---------- parser ----------
const CMP_OPS = ['=', '<>', '<', '>', '<=', '>='];
export function parse(src) {
  const toks = tokenize(src); let i = 0;
  const isOp = v => toks[i] && toks[i].k === 'op' && toks[i].v === v;
  const expect = v => { if (!isOp(v)) throw E.ERROR; i++; };
  const cmp = () => { let a = cat(); while (toks[i] && toks[i].k === 'op' && CMP_OPS.includes(toks[i].v)) { const op = toks[i++].v; a = { t: 'bin', op, a, b: cat() }; } return a; };
  const cat = () => { let a = add(); while (isOp('&')) { i++; a = { t: 'bin', op: '&', a, b: add() }; } return a; };
  const add = () => { let a = mul(); while (isOp('+') || isOp('-')) { const op = toks[i++].v; a = { t: 'bin', op, a, b: mul() }; } return a; };
  const mul = () => { let a = pow(); while (isOp('*') || isOp('/')) { const op = toks[i++].v; a = { t: 'bin', op, a, b: pow() }; } return a; };
  const pow = () => { let a = unary(); while (isOp('^')) { i++; a = { t: 'bin', op: '^', a, b: unary() }; } return a; };
  const unary = () => { if (isOp('-')) { i++; return { t: 'neg', a: unary() }; } if (isOp('+')) { i++; return unary(); } return postfix(); };
  const postfix = () => { let a = primary(); while (isOp('%')) { i++; a = { t: 'pct', a }; } return a; };
  const sep = () => isOp(',') || isOp(';');
  function primary() {
    const tk = toks[i++];
    if (!tk) throw E.ERROR;
    if (tk.k === 'num') return { t: 'num', v: tk.v };
    if (tk.k === 'str') return { t: 'str', v: tk.v };
    if (tk.k === 'err') return { t: 'err', v: tk.v };
    if (tk.k === 'ref') return refNode(tk);
    if (tk.k === 'id') {
      if (isOp('(')) {
        i++; const args = [];
        if (!isOp(')')) {
          for (;;) {
            if (sep() || isOp(')')) args.push({ t: 'blank' }); else args.push(cmp());
            if (sep()) { i++; continue; }
            break;
          }
        }
        expect(')');
        return { t: 'fn', name: tk.v, args };
      }
      if (tk.v === 'TRUE' || tk.v === 'VERDADERO') return { t: 'bool', v: true };
      if (tk.v === 'FALSE' || tk.v === 'FALSO') return { t: 'bool', v: false };
      return { t: 'err', v: E.NAME };
    }
    if (tk.k === 'op' && tk.v === '(') { const e = cmp(); expect(')'); return e; }
    throw E.ERROR;
  }
  const e = cmp();
  if (i < toks.length) throw E.ERROR;
  return e;
}

// ---------- coerción ----------
export function fmtGeneral(n) {
  if (!isFinite(n)) return '#NUM!';
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  const a = Math.abs(n);
  if (a >= 1e11 || (a < 1e-9 && n !== 0)) return n.toExponential(5).replace(/\.?0+e/, 'e').replace('e', 'E');
  return String(parseFloat(n.toPrecision(10)));
}
function num(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof FErr) throw v;
  const t = String(v).trim();
  if (NUM_RE.test(t)) return parseFloat(t);
  const p = /^([-+]?[\d.]+)%$/.exec(t);
  if (p) return parseFloat(p[1]) / 100;
  const d = parseDate(t);
  if (d !== null) return d;
  throw E.VALUE;
}
function str(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'number') return fmtGeneral(v);
  if (v instanceof FErr) throw v;
  return String(v);
}
function truthy(v) {
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'TRUE' || u === 'VERDADERO') return true;
    if (u === 'FALSE' || u === 'FALSO') return false;
    throw E.VALUE;
  }
  return num(v) !== 0;
}
function compare(a, b) {
  const rank = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2;
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 1) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}
export { compare as compareValues };
function binop(op, a, b) {
  if (a instanceof FErr) throw a;
  if (b instanceof FErr) throw b;
  switch (op) {
    case '+': return num(a) + num(b);
    case '-': return num(a) - num(b);
    case '*': return num(a) * num(b);
    case '/': { const d = num(b); if (d === 0) throw E.DIV0; return num(a) / d; }
    case '^': { const r = Math.pow(num(a), num(b)); if (!isFinite(r)) throw E.NUM; return r; }
    case '&': return str(a) + str(b);
    default: {
      const c = compare(a, b);
      return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
    }
  }
}
function roundTo(x, d, mode = 'round') {
  const f = Math.pow(10, d), a = Math.abs(x) * f, s = Math.sign(x);
  const fix = Math.abs(a - Math.round(a)) < 1e-9 ? Math.round(a) : a;
  const r = mode === 'up' ? Math.ceil(fix) : mode === 'down' ? Math.floor(fix) : Math.round(fix + 1e-9);
  return s * r / f;
}
function critFn(c) {
  if (typeof c === 'number' || typeof c === 'boolean')
    return v => v === c || (typeof v === 'string' && NUM_RE.test(v.trim()) && parseFloat(v) === c);
  let s = str(c), op = '=';
  const m = /^(<=|>=|<>|=|<|>)([\s\S]*)$/.exec(s);
  if (m) { op = m[1]; s = m[2]; }
  const st = s.trim();
  const n = NUM_RE.test(st) ? parseFloat(st) : parseDate(st);
  if (n !== null && st !== '') {
    return v => {
      const x = typeof v === 'number' ? v : (typeof v === 'string' && NUM_RE.test(v.trim()) ? parseFloat(v) : null);
      if (x === null) return op === '<>';
      return op === '=' ? x === n : op === '<>' ? x !== n : op === '<' ? x < n : op === '>' ? x > n : op === '<=' ? x <= n : x >= n;
    };
  }
  if (op === '=' || op === '<>') {
    const re = new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '.') + '$', 'i');
    return v => { const r = re.test(v == null ? '' : str(v)); return op === '=' ? r : !r; };
  }
  return v => {
    if (typeof v !== 'string') return false;
    const k = compare(v, s);
    return op === '<' ? k < 0 : op === '>' ? k > 0 : op === '<=' ? k <= 0 : k >= 0;
  };
}
function fmtPattern(v, f) {
  const n = num(v);
  const fl = f.toLowerCase();
  if (/[dmy]/.test(fl) && !/[0#]/.test(fl)) {
    const d = serialToDate(n);
    const M = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return fl.replace(/yyyy|aaaa/g, d.getUTCFullYear()).replace(/yy|aa/g, String(d.getUTCFullYear()).slice(2))
      .replace(/mmmm/g, M[d.getUTCMonth()]).replace(/mmm/g, M[d.getUTCMonth()].slice(0, 3))
      .replace(/mm/g, pad(d.getUTCMonth() + 1)).replace(/dd/g, pad(d.getUTCDate())).replace(/d/g, d.getUTCDate()).replace(/m/g, d.getUTCMonth() + 1);
  }
  const pct = f.includes('%');
  const x = pct ? n * 100 : n;
  const dec = (f.split('.')[1] || '').replace(/[^0#]/g, '').length;
  const grp = f.includes(',');
  const out = x.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: grp });
  return out + (pct ? '%' : '');
}

// ---------- alias en español ----------
export const ALIAS = {
  SUMA: 'SUM', PROMEDIO: 'AVERAGE', CONTAR: 'COUNT', CONTARA: 'COUNTA', 'CONTAR.BLANCO': 'COUNTBLANK',
  PRODUCTO: 'PRODUCT', REDONDEAR: 'ROUND', 'REDONDEAR.MAS': 'ROUNDUP', 'REDONDEAR.MENOS': 'ROUNDDOWN',
  ENTERO: 'INT', RESIDUO: 'MOD', POTENCIA: 'POWER', RAIZ: 'SQRT', SI: 'IF', 'SI.ERROR': 'IFERROR', 'SI.ND': 'IFNA',
  Y: 'AND', O: 'OR', NO: 'NOT', CONCATENAR: 'CONCATENATE', IZQUIERDA: 'LEFT', DERECHA: 'RIGHT', EXTRAE: 'MID',
  LARGO: 'LEN', MAYUSC: 'UPPER', MINUSC: 'LOWER', ESPACIOS: 'TRIM', NOMPROPIO: 'PROPER', VALOR: 'VALUE',
  TEXTO: 'TEXT', HOY: 'TODAY', AHORA: 'NOW', 'AÑO': 'YEAR', MES: 'MONTH', DIA: 'DAY', 'DÍA': 'DAY', FECHA: 'DATE',
  'SUMAR.SI': 'SUMIF', 'CONTAR.SI': 'COUNTIF', 'PROMEDIO.SI': 'AVERAGEIF', 'SUMAR.SI.CONJUNTO': 'SUMIFS', 'CONTAR.SI.CONJUNTO': 'COUNTIFS',
  BUSCARV: 'VLOOKUP', BUSCARH: 'HLOOKUP', INDICE: 'INDEX', 'ÍNDICE': 'INDEX', COINCIDIR: 'MATCH',
  ESBLANCO: 'ISBLANK', ESNUMERO: 'ISNUMBER', 'ESNÚMERO': 'ISNUMBER', ESTEXTO: 'ISTEXT', ESERROR: 'ISERROR',
  SUMAPRODUCTO: 'SUMPRODUCT', MEDIANA: 'MEDIAN', SUSTITUIR: 'SUBSTITUTE', REPETIR: 'REPT', ELEGIR: 'CHOOSE',
  ENCONTRAR: 'FIND', HALLAR: 'SEARCH', 'MAX': 'MAX', 'MIN': 'MIN', ABS: 'ABS', PI: 'PI', CONCAT: 'CONCAT'
};

// Lista para el menú "Insertar función"
export const FUNCTION_LIST = [
  ['SUMA', 'Suma todos los números de un rango', 'SUMA(A1:A10)'],
  ['PROMEDIO', 'Promedio de los números', 'PROMEDIO(A1:A10)'],
  ['CONTAR', 'Cuenta las celdas con números', 'CONTAR(A1:A10)'],
  ['CONTARA', 'Cuenta las celdas no vacías', 'CONTARA(A1:A10)'],
  ['MAX', 'Valor máximo', 'MAX(A1:A10)'],
  ['MIN', 'Valor mínimo', 'MIN(A1:A10)'],
  ['SI', 'Devuelve un valor si la condición es verdadera y otro si es falsa', 'SI(A1>0;"Sí";"No")'],
  ['SI.ERROR', 'Valor alternativo si hay error', 'SI.ERROR(A1/B1;0)'],
  ['SUMAR.SI', 'Suma las celdas que cumplen un criterio', 'SUMAR.SI(A1:A10;">5")'],
  ['CONTAR.SI', 'Cuenta las celdas que cumplen un criterio', 'CONTAR.SI(A1:A10;"texto")'],
  ['BUSCARV', 'Busca un valor en la primera columna', 'BUSCARV(A1;B1:D10;2;FALSO)'],
  ['REDONDEAR', 'Redondea a N decimales', 'REDONDEAR(A1;2)'],
  ['CONCATENAR', 'Une textos', 'CONCATENAR(A1;" ";B1)'],
  ['EXTRAE', 'Extrae caracteres del texto', 'EXTRAE(A1;4;7)'],
  ['IZQUIERDA', 'Caracteres de la izquierda', 'IZQUIERDA(A1;3)'],
  ['DERECHA', 'Caracteres de la derecha', 'DERECHA(A1;3)'],
  ['LARGO', 'Longitud del texto', 'LARGO(A1)'],
  ['MAYUSC', 'Convierte a mayúsculas', 'MAYUSC(A1)'],
  ['HOY', 'Fecha de hoy', 'HOY()'],
  ['AHORA', 'Fecha y hora actual', 'AHORA()'],
  ['TEXTO', 'Da formato a un número', 'TEXTO(A1;"0.00")'],
  ['SUMAPRODUCTO', 'Suma de productos', 'SUMAPRODUCTO(A1:A5;B1:B5)'],
  ['INDICE', 'Valor en una posición', 'INDICE(A1:C10;2;3)'],
  ['COINCIDIR', 'Posición de un valor', 'COINCIDIR(A1;B1:B10;0)']
];

// ---------- funciones ----------
// "R" = recibe rangos tal cual; el resto recibe valores simples.
function nums(calc, args) {
  const out = [];
  for (const a of args) {
    if (a && a.range) calc.each(a, v => { if (v instanceof FErr) throw v; if (typeof v === 'number') out.push(v); });
    else if (a != null) out.push(num(a));
  }
  return out;
}
const sum = arr => { let s = 0; for (const x of arr) s += x; return s; };
function vals(calc, args) {
  const out = [];
  for (const a of args) { if (a && a.range) calc.each(a, v => out.push(v)); else out.push(a); }
  return out;
}
function lookupEq(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}
const R = {
  SUM(a) { return sum(nums(this, a)); },
  AVERAGE(a) { const n = nums(this, a); if (!n.length) throw E.DIV0; return sum(n) / n.length; },
  MIN(a) { const n = nums(this, a); return n.length ? n.reduce((x, y) => y < x ? y : x) : 0; },
  MAX(a) { const n = nums(this, a); return n.length ? n.reduce((x, y) => y > x ? y : x) : 0; },
  MEDIAN(a) { const n = nums(this, a).sort((x, y) => x - y); if (!n.length) throw E.NUM; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  PRODUCT(a) { return nums(this, a).reduce((x, y) => x * y, 1); },
  COUNT(a) {
    let k = 0;
    for (const x of a) {
      if (x && x.range) this.each(x, v => { if (typeof v === 'number') k++; });
      else if (typeof x === 'number' || (typeof x === 'string' && NUM_RE.test(x.trim()))) k++;
    }
    return k;
  },
  COUNTA(a) { let k = 0; for (const x of a) { if (x && x.range) this.each(x, () => k++); else if (x != null) k++; } return k; },
  COUNTBLANK(a) {
    const rg = a[0]; if (!rg || !rg.range) throw E.VALUE;
    let k = 0; for (const row of this.matrix(rg)) for (const v of row) if (v == null || v === '') k++;
    return k;
  },
  AND(a) { const v = vals(this, a).filter(x => x != null && x !== ''); if (!v.length) throw E.VALUE; return v.every(x => { if (x instanceof FErr) throw x; return truthy(x); }); },
  OR(a) { const v = vals(this, a).filter(x => x != null && x !== ''); if (!v.length) throw E.VALUE; return v.some(x => { if (x instanceof FErr) throw x; return truthy(x); }); },
  CONCAT(a) { return vals(this, a).map(str).join(''); },
  SUMIF(a) {
    const [rg, c, sr] = a; if (!rg || !rg.range) throw E.VALUE;
    const f = critFn(this.scalar(c)); const tgt = sr && sr.range ? sr : rg; let s = 0;
    this.each(rg, (v, r, col) => {
      if (!f(v)) return;
      const x = this.value(tgt.sid, tgt.r1 + r - rg.r1, tgt.c1 + col - rg.c1);
      if (typeof x === 'number') s += x;
    });
    return s;
  },
  AVERAGEIF(a) {
    const [rg, c, sr] = a; if (!rg || !rg.range) throw E.VALUE;
    const f = critFn(this.scalar(c)); const tgt = sr && sr.range ? sr : rg; let s = 0, k = 0;
    this.each(rg, (v, r, col) => {
      if (!f(v)) return;
      const x = this.value(tgt.sid, tgt.r1 + r - rg.r1, tgt.c1 + col - rg.c1);
      if (typeof x === 'number') { s += x; k++; }
    });
    if (!k) throw E.DIV0; return s / k;
  },
  COUNTIF(a) { const [rg, c] = a; if (!rg || !rg.range) throw E.VALUE; const f = critFn(this.scalar(c)); let k = 0; this.each(rg, v => { if (f(v)) k++; }); return k; },
  SUMIFS(a) {
    const [sr, ...pairs] = a; if (!sr || !sr.range) throw E.VALUE;
    const conds = []; for (let i = 0; i < pairs.length; i += 2) conds.push([pairs[i], critFn(this.scalar(pairs[i + 1]))]);
    let s = 0;
    this.each(sr, (v, r, c) => {
      if (typeof v !== 'number') return;
      for (const [rg, f] of conds) if (!f(this.value(rg.sid, rg.r1 + r - sr.r1, rg.c1 + c - sr.c1))) return;
      s += v;
    });
    return s;
  },
  COUNTIFS(a) {
    const conds = []; for (let i = 0; i < a.length; i += 2) conds.push([a[i], critFn(this.scalar(a[i + 1]))]);
    const [base, f0] = conds[0]; if (!base || !base.range) throw E.VALUE; let k = 0;
    this.each(base, (v, r, c) => {
      if (!f0(v)) return;
      for (const [rg, f] of conds.slice(1)) if (!f(this.value(rg.sid, rg.r1 + r - base.r1, rg.c1 + c - base.c1))) return;
      k++;
    });
    return k;
  },
  VLOOKUP(a) {
    const v = this.scalar(a[0]), m = this.matrix(a[1]), col = num(this.scalar(a[2]));
    const approx = a[3] == null ? true : truthy(this.scalar(a[3]));
    if (col < 1 || (m[0] && col > m[0].length)) throw E.REF;
    let hit = -1;
    for (let i = 0; i < m.length; i++) {
      const x = m[i][0];
      if (approx) { if (x != null && compare(x, v) <= 0) hit = i; else if (x != null) break; }
      else if (lookupEq(x, v)) { hit = i; break; }
    }
    if (hit < 0) throw E.NA;
    return m[hit][col - 1] ?? 0;
  },
  HLOOKUP(a) {
    const v = this.scalar(a[0]), m = this.matrix(a[1]), row = num(this.scalar(a[2]));
    const approx = a[3] == null ? true : truthy(this.scalar(a[3]));
    if (row < 1 || row > m.length) throw E.REF;
    let hit = -1;
    for (let j = 0; j < (m[0] || []).length; j++) {
      const x = m[0][j];
      if (approx) { if (x != null && compare(x, v) <= 0) hit = j; else if (x != null) break; }
      else if (lookupEq(x, v)) { hit = j; break; }
    }
    if (hit < 0) throw E.NA;
    return m[row - 1][hit] ?? 0;
  },
  INDEX(a) {
    const m = this.matrix(a[0]); let r = num(this.scalar(a[1] ?? 0)), c = num(this.scalar(a[2] ?? 0));
    if (m.length === 1 && a[2] == null) { c = r; r = 1; }
    if (!c) c = 1; if (!r) r = 1;
    if (r > m.length || c > (m[0] || []).length) throw E.REF;
    return m[r - 1][c - 1] ?? 0;
  },
  MATCH(a) {
    const v = this.scalar(a[0]), m = this.matrix(a[1]), type = a[2] == null ? 1 : num(this.scalar(a[2]));
    const list = m.length === 1 ? m[0] : m.map(r => r[0]);
    let hit = -1;
    for (let i = 0; i < list.length; i++) {
      const x = list[i]; if (x == null) continue;
      if (type === 0) { if (lookupEq(x, v)) { hit = i; break; } }
      else if (type > 0) { if (compare(x, v) <= 0) hit = i; else break; }
      else { if (compare(x, v) >= 0) hit = i; else break; }
    }
    if (hit < 0) throw E.NA; return hit + 1;
  },
  SUMPRODUCT(a) {
    const ms = a.map(x => x && x.range ? this.matrix(x) : [[x]]);
    const h = ms[0].length, w = (ms[0][0] || []).length;
    if (ms.some(m => m.length !== h || (m[0] || []).length !== w)) throw E.VALUE;
    let s = 0;
    for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
      let p = 1; for (const m of ms) { const x = m[i][j]; p *= typeof x === 'number' ? x : 0; } s += p;
    }
    return s;
  }
};
const F = {
  ROUND: a => roundTo(num(a[0]), num(a[1])),
  ROUNDUP: a => roundTo(num(a[0]), num(a[1]), 'up'),
  ROUNDDOWN: a => roundTo(num(a[0]), num(a[1]), 'down'),
  INT: a => Math.floor(num(a[0])),
  ABS: a => Math.abs(num(a[0])),
  MOD: a => { const n = num(a[0]), d = num(a[1]); if (d === 0) throw E.DIV0; return n - d * Math.floor(n / d); },
  POWER: a => binop('^', a[0], a[1]),
  SQRT: a => { const n = num(a[0]); if (n < 0) throw E.NUM; return Math.sqrt(n); },
  PI: () => Math.PI,
  NOT: a => !truthy(a[0]),
  CONCATENATE: a => a.map(str).join(''),
  LEFT: a => str(a[0]).slice(0, a[1] == null ? 1 : num(a[1])),
  RIGHT: a => { const s = str(a[0]), n = a[1] == null ? 1 : num(a[1]); return n <= 0 ? '' : s.slice(-n); },
  MID: a => { const s = str(a[0]), st = num(a[1]), n = num(a[2]); if (st < 1 || n < 0) throw E.VALUE; return s.substr(st - 1, n); },
  LEN: a => str(a[0]).length,
  UPPER: a => str(a[0]).toUpperCase(),
  LOWER: a => str(a[0]).toLowerCase(),
  TRIM: a => str(a[0]).trim().replace(/ +/g, ' '),
  PROPER: a => str(a[0]).toLowerCase().replace(/(^|[^a-záéíóúñü])([a-záéíóúñü])/g, (m, p, c) => p + c.toUpperCase()),
  VALUE: a => num(a[0]),
  TEXT: a => fmtPattern(a[0], str(a[1])),
  SUBSTITUTE: a => {
    const s = str(a[0]), o = str(a[1]), n = str(a[2]);
    if (!o) return s;
    if (a[3] == null) return s.split(o).join(n);
    let k = num(a[3]), idx = -1;
    while (k-- > 0) { idx = s.indexOf(o, idx + 1); if (idx < 0) return s; }
    return s.slice(0, idx) + n + s.slice(idx + o.length);
  },
  REPT: a => str(a[0]).repeat(Math.max(0, num(a[1]))),
  FIND: a => { const i = str(a[1]).indexOf(str(a[0]), (a[2] == null ? 1 : num(a[2])) - 1); if (i < 0) throw E.VALUE; return i + 1; },
  SEARCH: a => { const i = str(a[1]).toLowerCase().indexOf(str(a[0]).toLowerCase(), (a[2] == null ? 1 : num(a[2])) - 1); if (i < 0) throw E.VALUE; return i + 1; },
  TODAY: () => todaySerial(),
  NOW: () => nowSerial(),
  YEAR: a => serialToDate(num(a[0])).getUTCFullYear(),
  MONTH: a => serialToDate(num(a[0])).getUTCMonth() + 1,
  DAY: a => serialToDate(num(a[0])).getUTCDate(),
  DATE: a => (Date.UTC(num(a[0]), num(a[1]) - 1, num(a[2])) - EPOCH) / 86400000,
  ISBLANK: a => a[0] == null,
  ISNUMBER: a => typeof a[0] === 'number',
  ISTEXT: a => typeof a[0] === 'string',
  CHOOSE: a => { const i = num(a[0]); if (i < 1 || i >= a.length) throw E.VALUE; return a[i]; }
};
const LAZY = new Set(['IF', 'IFERROR', 'IFNA', 'ISERROR', 'ISERR', 'ISNA']);

// ---------- calculadora ----------
export class Calc {
  constructor(model) { this.m = model; this.cache = new Map(); this.busy = new Set(); this.asts = new Map(); }
  reset() { this.cache.clear(); }
  ast(src) {
    let a = this.asts.get(src);
    if (!a) {
      try { a = parse(src); } catch (e) { a = { t: 'err', v: e instanceof FErr ? e : E.ERROR }; }
      if (this.asts.size > 30000) this.asts.clear();
      this.asts.set(src, a);
    }
    return a;
  }
  value(sid, r, c) {
    const k = sid + '|' + r + '|' + c;
    const hit = this.cache.get(k);
    if (hit !== undefined) return hit;
    const raw = this.m.raw(sid, r, c);
    let v;
    if (typeof raw === 'string' && raw.length > 1 && raw[0] === '=') {
      if (this.busy.has(k)) return E.CIRC;
      this.busy.add(k);
      try {
        v = this.ev(this.ast(raw.slice(1)), sid);
        if (v && v.range) v = this.single(v);
        if (v == null) v = 0;
        if (typeof v === 'number' && !isFinite(v)) v = E.NUM;
      } catch (e) {
        v = e instanceof FErr ? e : E.VALUE;
      } finally { this.busy.delete(k); }
    } else v = literal(raw);
    this.cache.set(k, v);
    return v;
  }
  sheetOf(name, sid) { if (!name) return sid; const s = this.m.sheetIdByName(name); if (!s) throw E.REF; return s; }
  single(rg) {
    if (rg.r1 === rg.r2 && rg.c1 === rg.c2) { const v = this.value(rg.sid, rg.r1, rg.c1); if (v instanceof FErr) throw v; return v; }
    throw E.VALUE;
  }
  scalar(v) { if (v && v.range) return this.single(v); if (v instanceof FErr) throw v; return v; }
  ev(n, sid) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': throw n.v;
      case 'blank': return null;
      case 'ref': {
        if (n.r < 0) throw E.REF;
        const v = this.value(this.sheetOf(n.sheet, sid), n.r, n.c);
        if (v instanceof FErr) throw v;
        return v;
      }
      case 'range': return { range: true, sid: this.sheetOf(n.sheet, sid), r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 };
      case 'neg': return -num(this.sc(n.a, sid));
      case 'pct': return num(this.sc(n.a, sid)) / 100;
      case 'bin': return binop(n.op, this.sc(n.a, sid), this.sc(n.b, sid));
      case 'fn': return this.call(n, sid);
    }
    throw E.ERROR;
  }
  sc(n, sid) { return this.scalar(this.ev(n, sid)); }
  call(n, sid) {
    let name = n.name.replace(/^_XLFN\./, '').replace(/^_XLWS\./, '');
    name = ALIAS[name] || name;
    const A = n.args;
    if (LAZY.has(name)) {
      if (name === 'IF') {
        const c = truthy(this.sc(A[0], sid));
        const b = c ? A[1] : A[2];
        if (!b) return c;
        return b.t === 'blank' ? 0 : this.sc(b, sid);
      }
      try {
        const v = this.sc(A[0], sid);
        if (name === 'IFERROR' || name === 'IFNA') return v;
        return false;
      } catch (e) {
        if (!(e instanceof FErr)) throw e;
        if (name === 'IFERROR') return A[1] ? this.sc(A[1], sid) : 0;
        if (name === 'IFNA') { if (e !== E.NA) throw e; return A[1] ? this.sc(A[1], sid) : 0; }
        if (name === 'ISNA') return e === E.NA;
        if (name === 'ISERR') return e !== E.NA;
        return true;
      }
    }
    if (R[name]) return R[name].call(this, A.map(a => this.ev(a, sid)), sid);
    if (F[name]) {
      const args = A.map(a => {
        if (a.t === 'ref' && (name === 'ISBLANK' || name === 'ISNUMBER' || name === 'ISTEXT')) {
          const v = this.value(this.sheetOf(a.sheet, sid), a.r, a.c);
          return v instanceof FErr ? v : v;
        }
        return this.sc(a, sid);
      });
      return F[name](args);
    }
    throw E.NAME;
  }
  bound(rg) {
    const mx = this.m.extent(rg.sid);
    return { ...rg, r2: Math.min(rg.r2, mx.r), c2: Math.min(rg.c2, mx.c) };
  }
  each(rg, fn) {
    const area = (rg.r2 - rg.r1 + 1) * (rg.c2 - rg.c1 + 1);
    if (!isFinite(area) || area > 3000) {
      for (const k of this.m.cellKeys(rg.sid)) {
        const p = parseKey(k);
        if (p && p.r >= rg.r1 && p.r <= rg.r2 && p.c >= rg.c1 && p.c <= rg.c2) {
          const v = this.value(rg.sid, p.r, p.c);
          if (v != null && v !== '') fn(v, p.r, p.c);
        }
      }
    } else {
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
        const v = this.value(rg.sid, r, c);
        if (v != null && v !== '') fn(v, r, c);
      }
    }
  }
  matrix(rg) {
    if (!rg || !rg.range) return [[this.scalar(rg)]];
    const b = this.bound(rg), m = [];
    for (let r = b.r1; r <= b.r2; r++) { const row = []; for (let c = b.c1; c <= b.c2; c++) row.push(this.value(b.sid, r, c)); m.push(row); }
    return m;
  }
}

// ---------- reescritura de fórmulas ----------
function mapRefs(raw, fn) {
  if (typeof raw !== 'string' || raw[0] !== '=') return raw;
  let toks; try { toks = tokenize(raw.slice(1)); } catch { return raw; }
  let out = raw.slice(1);
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]; if (t.k !== 'ref') continue;
    const rep = fn(t, t.text.slice(0, t.text.length - t.ref.length), t.ref.split(':').map(parseRefPart));
    if (rep != null) out = out.slice(0, t.p) + rep + out.slice(t.e);
  }
  return '=' + out;
}
// Copiar/pegar/rellenar: mueve referencias relativas
export function shiftFormula(raw, dr, dc) {
  return mapRefs(raw, (t, pre, parts) => {
    let bad = false;
    for (const p of parts) {
      if (!p.ac) p.c += dc;
      if (p.r !== null && !p.ar) p.r += dr;
      if (p.c < 0 || (p.r !== null && p.r < 0)) bad = true;
    }
    return bad ? '#REF!' : pre + parts.map(fmtPart).join(':');
  });
}
// Insertar (n>0) o eliminar (n<0) filas/columnas
export function adjustRefs(raw, ownSheet, target, axis, at, n) {
  const tl = target.toLowerCase();
  return mapRefs(raw, (t, pre, parts) => {
    if ((t.sheet ?? ownSheet).toLowerCase() !== tl) return null;
    const k = axis;
    if (parts.some(p => p[k] === null)) return null;
    if (n > 0) { for (const p of parts) if (p[k] >= at) p[k] += n; }
    else {
      const del = -n, end = at + del - 1;
      if (parts.length === 1) {
        const p = parts[0];
        if (p[k] >= at && p[k] <= end) return '#REF!';
        if (p[k] > end) p[k] -= del;
      } else {
        const [a, b] = parts, lo = Math.min(a[k], b[k]), hi = Math.max(a[k], b[k]);
        if (lo >= at && hi <= end) return '#REF!';
        a[k] = lo > end ? lo - del : lo >= at ? at : lo;
        b[k] = hi > end ? hi - del : hi >= at ? at - 1 : hi;
      }
    }
    return pre + parts.map(fmtPart).join(':');
  });
}
export function renameSheetRefs(raw, oldName, newName) {
  const ol = oldName.toLowerCase();
  return mapRefs(raw, t => (t.sheet && t.sheet.toLowerCase() === ol) ? quoteSheet(newName) + '!' + t.ref : null);
}
// Español -> inglés para exportar a .xlsx
export function toEnglish(raw) {
  if (typeof raw !== 'string' || raw[0] !== '=') return raw;
  let toks; try { toks = tokenize(raw.slice(1)); } catch { return raw; }
  let out = raw.slice(1);
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i];
    let rep = null;
    if (t.k === 'id' && ALIAS[t.v]) rep = ALIAS[t.v];
    else if (t.k === 'id' && (t.v === 'VERDADERO' || t.v === 'FALSO')) rep = t.v === 'VERDADERO' ? 'TRUE' : 'FALSE';
    else if (t.k === 'op' && t.v === ';') rep = ',';
    if (rep != null) out = out.slice(0, t.p) + rep + out.slice(t.e);
  }
  return out;
}
// Referencias usadas en una fórmula (para resaltarlas mientras se escribe)
export function formulaRefs(text) {
  if (typeof text !== 'string' || text[0] !== '=') return [];
  let toks; try { toks = tokenize(text.slice(1)); } catch { return []; }
  const out = [];
  for (const t of toks) if (t.k === 'ref') {
    const n = refNode(t);
    out.push(n.t === 'ref' ? { sheet: n.sheet, r1: n.r, c1: n.c, r2: n.r, c2: n.c } : { sheet: n.sheet, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 });
  }
  return out;
}

// ---------- formato de visualización ----------
const MONEY = { cur: 'S/ ', usd: '$ ', eur: '€ ' };
export function display(v, s) {
  s = s || {};
  if (v == null) return { t: '', al: 'l' };
  if (v instanceof FErr) return { t: v.code, al: 'c', err: true };
  if (typeof v === 'boolean') return { t: v ? 'VERDADERO' : 'FALSO', al: 'c' };
  if (typeof v === 'number') {
    const nf = s.nf;
    const d = s.d;
    const fx = (x, dd) => x.toLocaleString('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd });
    if (nf === 'num') return { t: fx(v, d ?? 2), al: 'r' };
    if (MONEY[nf]) return { t: (v < 0 ? '-' : '') + MONEY[nf] + fx(Math.abs(v), d ?? 2), al: 'r' };
    if (nf === 'pct') return { t: (v * 100).toFixed(d ?? 0) + '%', al: 'r' };
    if (nf === 'date') return { t: fmtDate(v), al: 'r' };
    if (nf === 'time') return { t: fmtTime(v), al: 'r' };
    if (nf === 'text') return { t: fmtGeneral(v), al: 'l' };
    if (d != null) return { t: v.toFixed(d), al: 'r' };
    return { t: fmtGeneral(v), al: 'r' };
  }
  return { t: String(v), al: 'l' };
}
