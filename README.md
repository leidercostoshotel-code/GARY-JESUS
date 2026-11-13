# Excel del Hotel

Hoja de cálculo con el aspecto de Microsoft Excel que guarda todo en **Firebase** y
permite que **varias personas editen el mismo libro a la vez** (cada una ve el cursor
y el nombre de las demás). Cada cambio se guarda solo, al instante.

- `index.html` tiene 17 líneas; toda la lógica está en JavaScript (`js/`) y el diseño en `css/excel.css`.
- Se puede **instalar en la computadora** como aplicación (Chrome / Edge → botón **Instalar**).
- Al abrir, se elige el libro: **PEDIDO BODEGAS 2024** o **PEDIDO DE COCINA 2024**. La primera vez que alguien abre cada uno, su `.xlsx` se carga solo en Firebase.

## Qué incluye

| Área | Funciones |
|---|---|
| Cinta | Archivo, Inicio, Insertar, Fórmulas, Datos, Vista |
| Formato | Negrita, cursiva, subrayado, fuente, tamaño, colores de relleno y de fuente, bordes, alineación, ajustar texto, formatos de número (S/, $, %, fecha, millares, decimales), copiar formato |
| Fórmulas | `SUMA`, `PROMEDIO`, `CONTAR`, `SI`, `SI.ERROR`, `SUMAR.SI`, `CONTAR.SI`, `BUSCARV`, `EXTRAE`, `REDONDEAR`, `HOY`… en español **o** inglés, con `;` o `,`. Referencias a otras hojas (`'02 de enero'!H17`) |
| Edición | Barra de fórmulas, cuadro de nombres, controlador de relleno, copiar/cortar/pegar (también desde y hacia Excel), deshacer/rehacer, buscar, ordenar, insertar/eliminar filas y columnas, ancho y alto ajustables |
| Hojas | Agregar, cambiar nombre, mover, eliminar; **Plantilla de pedido** con el formato de *PEDIDO BODEGAS 2024* |
| Archivos | Importar `.xlsx` (por ejemplo los dos archivos de este repositorio), descargar `.xlsx` y `.csv`, imprimir |
| Equipo | Presencia en tiempo real, enlace para compartir, varios libros (`#libro=codigo`) |

## Lecturas y escrituras eficientes

- Cada persona descarga **solo la hoja que abre** (y las hojas que usan sus fórmulas); después recibe solo los cambios.
- Cada edición escribe **solo la celda modificada** (`libros/{libro}/celdas/{hoja}/{A1}`), no la hoja completa.
- La posición de los compañeros se envía como máximo cada 0,4 s y solo si cambió.
- Los libros del repositorio se cargan una sola vez, con identificadores fijos de hoja, así que si dos personas los abren a la vez no se duplican.
- Exportar a .xlsx o cambiar el nombre de una hoja descarga todas las hojas, porque lo necesita.
- Al insertar o eliminar filas/columnas se corrigen las fórmulas de las hojas ya cargadas; las referencias desde hojas que nadie ha abierto en esa sesión no se ajustan.

## Subir una versión nueva de los Excel

1. Reemplaza el archivo en el repositorio **con el mismo nombre** (`PEDIDO BODEGAS 2024.xlsx` o
   `PEDIDO DE COCINA 2024 - copia.xlsx`).
2. Publica (`git pull` y `firebase deploy --only hosting`).
3. La primera persona que abra el libro lo actualiza en la nube para todos:
   - Primero solo pregunta si el archivo cambió (sin descargarlo).
   - Las hojas cuya huella no cambió **no se leen ni se escriben**.
   - En las hojas que cambiaron, solo se escriben las celdas que el Excel cambió respecto a su versión anterior.
     Lo que el equipo escribió en la página en otras celdas se respeta.
   - Las hojas nuevas del Excel se agregan; las hojas creadas en la página no se borran, y una hoja que alguien borró
     en la página no se vuelve a crear.

También se puede hacer a mano con **Datos → Actualizar desde Excel**, eligiendo el archivo.
`datos/base/` guarda la versión con la que se cargaron los libros la primera vez; no la borres.

## Configurar Firebase (una sola vez)

1. Entra a <https://console.firebase.google.com> y crea un proyecto.
2. **Compilación → Realtime Database → Crear base de datos**.
3. **Compilación → Authentication → Método de acceso → Anónimo → Habilitar**.
4. **Configuración del proyecto → Tus apps → Web (`</>`)** y copia los datos en `js/firebase-config.js`
   (incluido `databaseURL`).
5. En **Realtime Database → Reglas**, pega el contenido de `database.rules.json` y publica.

Sin estos datos la página funciona en **modo local**: guarda en el navegador y sincroniza
entre pestañas de la misma computadora.

## Publicación automática

Cada cambio en la rama `main` se publica con GitHub Actions (`.github/workflows/publicar.yml`).
La primera vez, un administrador del repositorio debe ir a
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
La dirección será `https://<usuario>.github.io/<repositorio>/`.

También se puede publicar con Firebase Hosting:

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase deploy
```

## Ícono

El ícono de instalación y el de la pestaña salen de `img/hotel.jpg`. Para usar la foto real del hotel,
guárdala como `img/hotel-foto.jpg` y ejecuta:

```bash
python3 tools/generar_imagenes.py
```

## Atajos

`Ctrl+Z / Ctrl+Y` deshacer y rehacer · `Ctrl+C / X / V` copiar, cortar y pegar · `F2` editar ·
`Alt+=` autosuma · `Ctrl+;` fecha de hoy · `Ctrl+D` rellenar hacia abajo · `Ctrl+F` buscar ·
`Ctrl+flechas` saltar al final de los datos · `Alt+Enter` salto de línea en la celda.
