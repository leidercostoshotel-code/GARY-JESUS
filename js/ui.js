// =====================================================================
//  Construcción de la interfaz (barra de título, cinta, barra de fórmulas,
//  cuadrícula, pestañas de hojas y barra de estado) — todo desde JavaScript
// =====================================================================
const ic = (name, cls = '') => `<span class="ms ${cls}">${name}</span>`;
const big = (cmd, icon, label, title = label) =>
  `<button class="rb big" data-cmd="${cmd}" title="${title}">${ic(icon)}<span class="lbl">${label}</span></button>`;
const sm = (cmd, icon, title, label = '') =>
  `<button class="rb sm" data-cmd="${cmd}" title="${title}">${ic(icon)}${label ? `<span class="lbl">${label}</span>` : ''}</button>`;
const txt = (cmd, html, title) => `<button class="rb sm tx" data-cmd="${cmd}" title="${title}">${html}</button>`;
const split = (cmd, icon, title, barId) =>
  `<span class="split"><button class="rb sm" data-cmd="${cmd}" title="${title}">${ic(icon)}<i class="cbar" id="${barId}"></i></button><button class="rb dd" data-cmd="${cmd}Menu" title="Más colores">${ic('arrow_drop_down')}</button></span>`;
const group = (label, body) => `<div class="rgroup"><div class="rbody">${body}</div><div class="rlabel">${label}</div></div>`;
const col = body => `<div class="rcol">${body}</div>`;
const row = body => `<div class="rrow">${body}</div>`;
const sel = (cmd, cls, opts, title) =>
  `<select class="rsel ${cls}" data-cmd="${cmd}" title="${title}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;

export const FONTS = ['Aptos Narrow', 'Calibri', 'Arial', 'Segoe UI', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia'];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const NUMFMT = [['', 'General'], ['num', 'Número'], ['cur', 'Moneda (S/)'], ['usd', 'Dólares ($)'], ['pct', 'Porcentaje'], ['date', 'Fecha corta'], ['time', 'Hora'], ['text', 'Texto']];

const RIBBON = {
  inicio: [
    group('Portapapeles', big('paste', 'content_paste', 'Pegar', 'Pegar (Ctrl+V)') +
      col(sm('cut', 'content_cut', 'Cortar (Ctrl+X)', 'Cortar') + sm('copy', 'content_copy', 'Copiar (Ctrl+C)', 'Copiar') + sm('painter', 'format_paint', 'Copiar formato', 'Copiar formato'))),
    group('Fuente',
      col(row(sel('font', 'w-font', FONTS.map(f => [f, f]), 'Fuente') + sel('size', 'w-size', SIZES.map(s => [s, s]), 'Tamaño de fuente') +
        sm('grow', 'text_increase', 'Aumentar tamaño de fuente') + sm('shrink', 'text_decrease', 'Disminuir tamaño de fuente')) +
        row(txt('bold', '<b>N</b>', 'Negrita (Ctrl+B)') + txt('italic', '<i>K</i>', 'Cursiva (Ctrl+I)') + txt('underline', '<u>S</u>', 'Subrayado (Ctrl+U)') +
          '<span class="vsep"></span>' + sm('bordersMenu', 'border_all', 'Bordes') + '<span class="vsep"></span>' +
          split('fill', 'format_color_fill', 'Color de relleno', 'fillBar') + split('color', 'format_color_text', 'Color de fuente', 'colorBar')))),
    group('Alineación',
      col(row(sm('vtop', 'vertical_align_top', 'Alinear arriba') + sm('vmid', 'vertical_align_center', 'Alinear en el medio') + sm('vbot', 'vertical_align_bottom', 'Alinear abajo') +
        '<span class="vsep"></span>' + sm('wrap', 'wrap_text', 'Ajustar texto', 'Ajustar texto')) +
        row(sm('left', 'format_align_left', 'Alinear a la izquierda') + sm('center', 'format_align_center', 'Centrar') + sm('right', 'format_align_right', 'Alinear a la derecha')))),
    group('Número',
      col(row(sel('numfmt', 'w-num', NUMFMT, 'Formato de número')) +
        row(txt('fmtCur', 'S/', 'Formato de moneda (Soles)') + sm('fmtPct', 'percent', 'Estilo porcentual') + txt('fmtNum', '000', 'Estilo millares') +
          sm('decInc', 'decimal_increase', 'Aumentar decimales') + sm('decDec', 'decimal_decrease', 'Disminuir decimales')))),
    group('Celdas', big('insertMenu', 'add_box', 'Insertar') + big('deleteMenu', 'disabled_by_default', 'Eliminar') + big('formatMenu', 'view_column', 'Formato')),
    group('Edición',
      col(sm('autosum', 'functions', 'Autosuma (Alt+=)', 'Autosuma') + sm('clearMenu', 'ink_eraser', 'Borrar', 'Borrar') + sm('sortMenu', 'sort', 'Ordenar', 'Ordenar')) +
      big('find', 'search', 'Buscar', 'Buscar (Ctrl+F)'))
  ],
  insertar: [
    group('Celdas', big('insRows', 'table_rows', 'Filas', 'Insertar filas arriba') + big('insCols', 'view_week', 'Columnas', 'Insertar columnas a la izquierda')),
    group('Hojas', big('addSheet', 'note_add', 'Nueva hoja') + big('template', 'receipt_long', 'Plantilla de pedido', 'Hoja de pedido como en PEDIDO BODEGAS 2024')),
    group('Datos rápidos', big('today', 'calendar_today', 'Fecha de hoy', 'Insertar la fecha de hoy (Ctrl+;)') + big('now', 'schedule', 'Hora actual')),
    group('Funciones', big('fnMenu', 'function', 'Función', 'Insertar función'))
  ],
  formulas: [
    group('Biblioteca de funciones', big('fnMenu', 'function', 'Insertar función') + big('autosum', 'functions', 'Autosuma') +
      col(sm('fnPROMEDIO', 'avg_pace', 'Promedio', 'Promedio') + sm('fnCONTAR', 'tag', 'Contar números', 'Contar') + sm('fnMAX', 'arrow_upward', 'Máximo', 'Máx')) +
      col(sm('fnMIN', 'arrow_downward', 'Mínimo', 'Mín') + sm('fnSI', 'call_split', 'Función SI', 'SI') + sm('fnBUSCARV', 'manage_search', 'BUSCARV', 'BUSCARV'))),
    group('Auditoría', big('showFormulas', 'data_object', 'Mostrar fórmulas', 'Mostrar fórmulas (Ctrl+`)')),
    group('Cálculo', big('recalc', 'calculate', 'Calcular ahora'))
  ],
  datos: [
    group('Ordenar', big('sortAZ', 'north', 'A → Z', 'Ordenar de A a Z') + big('sortZA', 'south', 'Z → A', 'Ordenar de Z a A')),
    group('Obtener datos', big('import', 'upload_file', 'Importar Excel', 'Abrir un archivo .xlsx (por ejemplo PEDIDO BODEGAS 2024.xlsx)')),
    group('Exportar', big('exportXlsx', 'download', 'Descargar .xlsx') + big('exportCsv', 'csv', 'Descargar CSV'))
  ],
  vista: [
    group('Zoom', big('zoomIn', 'zoom_in', 'Acercar') + big('zoomOut', 'zoom_out', 'Alejar') + big('zoom100', 'fit_screen', '100%')),
    group('Mostrar', big('grid', 'grid_on', 'Cuadrícula', 'Mostrar u ocultar líneas de cuadrícula') + big('bgToggle', 'apartment', 'Fondo del hotel', 'Mostrar u ocultar la foto de fondo')),
    group('Ventana', big('fullscreen', 'fullscreen', 'Pantalla completa') + big('install', 'install_desktop', 'Instalar app', 'Instalar en esta computadora'))
  ]
};

export function buildUI(root) {
  root.innerHTML = `
  <div class="bgphoto"></div>
  <header class="titlebar">
    <div class="tb-left">
      <span class="logo" title="Excel en la nube"><img src="icons/icon-192.png" alt=""></span>
      <span class="autosave" title="Cada cambio se guarda automáticamente">Autoguardado <span class="switch on"><i></i></span></span>
      <button class="tbtn" data-cmd="save" title="Guardado automático">${ic('save')}</button>
      <button class="tbtn" data-cmd="undo" title="Deshacer (Ctrl+Z)">${ic('undo')}</button>
      <button class="tbtn" data-cmd="redo" title="Rehacer (Ctrl+Y)">${ic('redo')}</button>
    </div>
    <div class="tb-title"><span id="bookName" title="Cambiar el nombre del libro">Libro1</span><span class="dim"> - Excel</span>
      <span id="cloud" class="cloud">${ic('cloud_sync')}<span>Conectando…</span></span></div>
    <div class="tb-right">
      <div id="users" class="users"></div>
      <button class="tbtn install" data-cmd="install" id="installBtn" hidden title="Instalar en esta computadora">${ic('install_desktop')}<span>Instalar</span></button>
      <button class="share" data-cmd="share">${ic('share')}<span>Compartir</span></button>
    </div>
  </header>
  <nav class="rtabs">
    <button class="rtab file" data-tab="archivo">Archivo</button>
    <button class="rtab on" data-tab="inicio">Inicio</button>
    <button class="rtab" data-tab="insertar">Insertar</button>
    <button class="rtab" data-tab="formulas">Fórmulas</button>
    <button class="rtab" data-tab="datos">Datos</button>
    <button class="rtab" data-tab="vista">Vista</button>
  </nav>
  <div class="ribbon">${Object.entries(RIBBON).map(([k, g]) => `<div class="rpanel${k === 'inicio' ? ' on' : ''}" data-panel="${k}">${g.join('<span class="gsep"></span>')}</div>`).join('')}</div>
  <div class="fbar">
    <input id="namebox" class="namebox" spellcheck="false" title="Cuadro de nombres">
    <span class="fsep">⋮</span>
    <button class="fxb" data-cmd="cancelEdit" title="Cancelar">${ic('close')}</button>
    <button class="fxb" data-cmd="commitEdit" title="Introducir">${ic('check')}</button>
    <button class="fxb" data-cmd="fnMenu" title="Insertar función"><i class="fx">fx</i></button>
    <input id="fx" class="fxin" spellcheck="false" autocomplete="off">
  </div>
  <div class="gw" id="gw">
    <div class="gc" id="gc">
      <div class="chdr" id="chdr"><div class="corner" id="corner"><i></i></div><div id="colheads"></div></div>
      <div class="rhdr" id="rhdr"></div>
      <div class="cells" id="cells"></div>
      <div class="ovl" id="ovl"></div>
      <textarea id="ed" class="ed idle" spellcheck="false" autocomplete="off"></textarea>
    </div>
  </div>
  <footer class="sheetbar">
    <button class="snav" data-cmd="tabsLeft" title="Hoja anterior">${ic('chevron_left')}</button>
    <button class="snav" data-cmd="tabsRight" title="Hoja siguiente">${ic('chevron_right')}</button>
    <div class="stabs" id="stabs"></div>
    <button class="sadd" data-cmd="addSheet" title="Nueva hoja">${ic('add_circle')}</button>
  </footer>
  <div class="status">
    <span id="smode">Listo</span>
    <span id="sinfo" class="sinfo"></span>
    <span class="grow"></span>
    <span id="stats" class="stats"></span>
    <span class="views">${ic('grid_view', 'on')}${ic('description')}${ic('view_quilt')}</span>
    <button class="zbtn" data-cmd="zoomOut">−</button>
    <input type="range" id="zoom" min="25" max="300" step="5" value="100">
    <button class="zbtn" data-cmd="zoomIn">+</button>
    <span id="zoomv" class="zoomv">100%</span>
  </div>
  <input type="file" id="file" accept=".xlsx,.xls,.xlsm,.csv" hidden>
  <div id="toasts" class="toasts"></div>`;
  const q = id => root.querySelector('#' + id);
  return {
    gw: q('gw'), gc: q('gc'), chdr: q('chdr'), colheads: q('colheads'), corner: q('corner'), rhdr: q('rhdr'),
    cells: q('cells'), ovl: q('ovl'), ed: q('ed'), fx: q('fx'), namebox: q('namebox'), stabs: q('stabs'),
    smode: q('smode'), sinfo: q('sinfo'), stats: q('stats'), zoom: q('zoom'), zoomv: q('zoomv'), file: q('file'),
    toasts: q('toasts'), bookName: q('bookName'), cloud: q('cloud'), users: q('users'), installBtn: q('installBtn'),
    fillBar: q('fillBar'), colorBar: q('colorBar')
  };
}

// ---------- menús flotantes y diálogos ----------
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
export function menu(items, at) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="msep"></div>'
    : it.html ? `<div class="mhtml">${it.html}</div>`
    : `<button class="mi" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? `<span class="ms">${it.icon}</span>` : '<span class="ms"></span>'}<span class="mt">${it.label}</span>${it.hint ? `<span class="mh">${it.hint}</span>` : ''}</button>`).join('');
  document.body.appendChild(m);
  let x, y;
  if (at instanceof Element) { const r = at.getBoundingClientRect(); x = r.left; y = r.bottom + 2; } else { x = at.x; y = at.y; }
  const mr = m.getBoundingClientRect();
  x = Math.max(4, Math.min(x, innerWidth - mr.width - 4));
  if (y + mr.height > innerHeight - 4) y = Math.max(4, innerHeight - mr.height - 4);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m.addEventListener('mousedown', e => e.preventDefault());
  m.addEventListener('click', e => {
    const b = e.target.closest('.mi'); if (!b) return;
    const it = items[+b.dataset.i]; closeMenu(); it.run && it.run();
  });
  openMenu = m;
  return m;
}
document.addEventListener('mousedown', e => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); }, true);

export function dialog({ title, text = '', input = null, ok = 'Aceptar', cancel = 'Cancelar', html = '', hero = false }) {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.className = 'modal' + (hero ? ' hero' : '');
    d.innerHTML = `<div class="mbox">${hero ? '<div class="mhero"><img src="icons/icon-192.png" alt=""><div><b>Excel del Hotel</b><span>Hojas de cálculo compartidas en tiempo real</span></div></div>' : ''}
      <h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${html}
      ${input !== null ? `<input class="min" value="${String(input).replace(/"/g, '&quot;')}">` : ''}
      <div class="mbtns">${cancel ? `<button class="mb2">${cancel}</button>` : ''}<button class="mb1">${ok}</button></div></div>`;
    document.body.appendChild(d);
    const inp = d.querySelector('.min');
    const done = v => { d.remove(); resolve(v); };
    d.querySelector('.mb1').onclick = () => done(inp ? inp.value : true);
    const c = d.querySelector('.mb2'); if (c) c.onclick = () => done(null);
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); done(inp ? inp.value : true); }
      if (e.key === 'Escape' && cancel) { e.preventDefault(); done(null); }
      e.stopPropagation();
    });
    setTimeout(() => (inp || d.querySelector('.mb1')).focus(), 30);
    if (inp) setTimeout(() => inp.select(), 40);
  });
}
