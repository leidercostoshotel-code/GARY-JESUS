# Excel del Hotel

Hoja de cálculo con el aspecto de Microsoft Excel que guarda todo en **Firebase** y
permite que **varias personas editen el mismo libro a la vez** (cada una ve el cursor
y el nombre de las demás). Cada cambio se guarda solo, al instante.

- `index.html` tiene 17 líneas; toda la lógica está en JavaScript (`js/`) y el diseño en `css/excel.css`.
- Se puede **instalar en la computadora** como aplicación (Chrome / Edge → botón **Instalar**).
- Fondo e ícono con la foto del hotel (`img/hotel.jpg`).

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

## Foto del hotel

`img/hotel.jpg` es una ilustración provisional. Para usar la foto real, súbela con ese mismo
nombre (`img/hotel.jpg`). El fondo y el ícono de la pestaña la usan al instante. Para regenerar
también los íconos de instalación, guarda la foto como `img/hotel-foto.jpg` y ejecuta:

```bash
python3 tools/generar_imagenes.py
```

## Atajos

`Ctrl+Z / Ctrl+Y` deshacer y rehacer · `Ctrl+C / X / V` copiar, cortar y pegar · `F2` editar ·
`Alt+=` autosuma · `Ctrl+;` fecha de hoy · `Ctrl+D` rellenar hacia abajo · `Ctrl+F` buscar ·
`Ctrl+flechas` saltar al final de los datos · `Alt+Enter` salto de línea en la celda.
