// =====================================================================
//  Lee el formato original de un .xlsx (bordes, negrita, tamaño y color
//  de letra, rellenos y alineación) desde xl/styles.xml, que la librería
//  de lectura no expone.
// =====================================================================

// Paleta clásica de Excel (colores "indexed")
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000',
  '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99',
  '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

const kids = (el, tag) => (el ? [...el.children].filter(e => e.localName === tag) : []);
const one = (el, tag) => kids(el, tag)[0] || null;
const parse = s => new DOMParser().parseFromString(s, 'application/xml');

function tint(hex, t) {
  if (!t) return hex;
  let r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0, l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const f = (p, q, x) => { if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  if (s === 0) r = g = b = l;
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); }
  return [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function extractStyles(wb) {
  const files = wb.files || {};
  const txt = name => {
    const f = files[name] || files['/' + name];
    if (!f) return null;
    const c = f.content;
    return typeof c === 'string' ? c : new TextDecoder().decode(c);
  };
  const stylesXml = txt('xl/styles.xml');
  if (!stylesXml) return {};

  // ---- tema
  const theme = [...DEFAULT_THEME];
  const th = txt('xl/theme/theme1.xml');
  if (th) {
    const cs = parse(th).getElementsByTagNameNS('*', 'clrScheme')[0];
    if (cs) {
      const val = n => { const e = one(cs, n); const c = e && e.firstElementChild; return c ? (c.getAttribute('lastClr') || c.getAttribute('val') || '').toUpperCase() : null; };
      const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
      order.forEach((n, i) => { const v = val(n); if (v && /^[0-9A-F]{6}$/.test(v)) theme[i] = v; });
    }
  }
  const color = el => {
    if (!el || el.getAttribute('auto') === '1') return null;
    let hex = null;
    const rgb = el.getAttribute('rgb'), th2 = el.getAttribute('theme'), ix = el.getAttribute('indexed');
    if (rgb) hex = rgb.slice(-6).toUpperCase();
    else if (th2 != null) hex = theme[+th2] || null;
    else if (ix != null) hex = +ix >= 64 ? null : INDEXED[+ix];
    if (!hex) return null;
    return tint(hex, parseFloat(el.getAttribute('tint') || '0'));
  };

  // ---- styles.xml
  const sd = parse(stylesXml).documentElement;
  const fonts = kids(one(sd, 'fonts'), 'font').map(f => {
    const v = (t, a = 'val') => { const e = one(f, t); return e ? (e.getAttribute(a) ?? '1') : null; };
    return {
      b: one(f, 'b') && v('b') !== '0', i: one(f, 'i') && v('i') !== '0', u: one(f, 'u') && v('u') !== 'none',
      sz: parseFloat(v('sz') || '11'), name: v('name'), color: color(one(f, 'color'))
    };
  });
  const base = fonts[0] || { sz: 11, name: 'Calibri' };
  const fills = kids(one(sd, 'fills'), 'fill').map(f => {
    const p = one(f, 'patternFill');
    if (!p) return null;
    const pt = p.getAttribute('patternType');
    if (!pt || pt === 'none') return null;
    const c = color(one(p, 'fgColor')) || (pt === 'solid' ? null : color(one(p, 'bgColor')));
    return c;
  });
  const borders = kids(one(sd, 'borders'), 'border').map(b => {
    const w = side => { const e = one(b, side); const st = e && e.getAttribute('style'); return !st || st === 'none' ? 0 : /medium|thick|double/.test(st) ? 2 : 1; };
    return { t: w('top'), b: w('bottom'), l: w('left'), r: w('right') };
  });
  const xfs = kids(one(sd, 'cellXfs'), 'xf').map(x => {
    const s = {};
    const f = fonts[+(x.getAttribute('fontId') || 0)];
    if (f) {
      if (f.b) s.b = 1; if (f.i) s.i = 1; if (f.u) s.u = 1;
      if (f.sz && Math.abs(f.sz - base.sz) > 0.01) s.fs = f.sz;
      if (f.color && f.color !== '000000') s.c = '#' + f.color.toLowerCase();
      if (f.name && f.name !== base.name && !/^(Calibri|Aptos)/i.test(f.name)) s.ff = f.name;
    }
    const fill = fills[+(x.getAttribute('fillId') || 0)];
    if (fill && fill !== 'FFFFFF') s.f = '#' + fill.toLowerCase();
    const bd = borders[+(x.getAttribute('borderId') || 0)];
    if (bd) {
      if (bd.t === 1 && bd.b === 1 && bd.l === 1 && bd.r === 1) s.bd = 'a';
      else { if (bd.t) s.bt = bd.t; if (bd.b) s.bb = bd.b; if (bd.l) s.bl = bd.l; if (bd.r) s.br = bd.r; }
    }
    const al = one(x, 'alignment');
    if (al) {
      const h = al.getAttribute('horizontal'), v = al.getAttribute('vertical');
      if (h === 'left') s.a = 'l'; else if (h === 'center' || h === 'centerContinuous') s.a = 'c'; else if (h === 'right') s.a = 'r';
      if (v === 'top') s.va = 't'; else if (v === 'center') s.va = 'm';
      if (al.getAttribute('wrapText') === '1' || al.getAttribute('wrapText') === 'true') s.w = 1;
    }
    return Object.keys(s).length ? s : null;
  });

  // ---- hojas: nombre -> archivo
  const wbXml = txt('xl/workbook.xml'), relXml = txt('xl/_rels/workbook.xml.rels');
  if (!wbXml || !relXml) return {};
  const rels = {};
  for (const r of parse(relXml).getElementsByTagNameNS('*', 'Relationship')) {
    let t = r.getAttribute('Target');
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    rels[r.getAttribute('Id')] = t;
  }
  const out = {};
  for (const sh of parse(wbXml).getElementsByTagNameNS('*', 'sheet')) {
    const name = sh.getAttribute('name');
    const rid = sh.getAttribute('r:id') || [...sh.attributes].find(a => a.localName === 'id')?.value;
    const xml = rels[rid] && txt(rels[rid]);
    if (!xml) continue;
    const map = {};
    const re = /<c\b([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrs = m[1];
      const r = /\br="([A-Z]+\d+)"/.exec(attrs), s = /\bs="(\d+)"/.exec(attrs);
      if (!r || !s || s[1] === '0') continue;
      const st = xfs[+s[1]];
      if (st) map[r[1]] = st;
    }
    out[name] = map;
  }
  return out;
}
