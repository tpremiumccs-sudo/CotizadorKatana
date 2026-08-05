# Manual del Cotizador

Para armar y mandar cotizaciones. No hace falta saber nada técnico.

---

## Lo primero: la idea

El **tarifario** guarda el precio de lista de cada talento en cada formato.
Cuando armas una cotización, el sistema **copia** esos precios y ahí los ajustas
para esa marca.

Ajustar un precio en una cotización **no cambia el tarifario**. Bajarle a HONOR
no se lo baja a todos los demás clientes. Y como el sistema guarda las dos
cifras —la de lista y la que cobraste—, siempre puedes enseñar de dónde salió
cada número.

Es como trabajaban ya, sólo que ahora queda registrado.

---

## Armar un tabulador en cinco minutos

### 1. Nueva cotización

**Cotizaciones** → *Nueva cotización*.

- **Cliente:** el nombre que se imprime. `HONOR`.
- **Contacto:** con quién estás tratando. Sale en el documento.
- **Proyecto:** opcional, para encontrarla después.

Marca los **talentos** y los **formatos** que van a ser las columnas. Si el
tabulador lleva más de seis columnas, el sistema te avisa: en hoja carta se
vuelve ilegible.

*Crear y abrir el editor*.

### 2. Ajustar los precios

A la izquierda la cuadrícula, a la derecha **el documento tal como lo va a ver
la marca**. Escribe un precio, sal del campo, y el documento cambia al instante.

Debajo de cada celda ajustada aparece de dónde salió:

> ● Base $195,000 · −$45,000 (−23.1%)

Eso es lo que respondes cuando alguien pregunta por qué esta marca paga menos.

**Si el tarifario dice "Pendiente"**, el campo está vacío con esa palabra de
fondo. Escribe la cifra encima y ya: no hay que abrir nada aparte.

**El menú ⋯** de cada celda marca el formato como *Pendiente*, *Caso por caso* o
*No aplica*, y devuelve la celda al precio del tarifario.

Arriba a la derecha dice si está **Guardado**. Se guarda solo, poco después de
que dejes de escribir.

### 3. Bajar el PDF

**Descargar PDF**. En iPad y celular abre directamente el menú de compartir, así
que va a WhatsApp o al correo sin pasar por la carpeta de descargas.

El botón se apaga mientras hay un cambio sin guardar. Es a propósito: el PDF lo
arma el servidor con lo guardado, y si lo bajaras a medias saldría con la cifra
anterior — y ese archivo es el que acaba en el correo de la marca.

---

## Cosas que conviene saber

### El nombre del archivo

`Tabulador_HONOR_2026-08-05.pdf`. Se encuentra buscando "HONOR" entre los otros
veinte PDFs del chat.

### Cuando no hay precio

| En el tarifario | En el documento | Suma al total |
|---|---|---|
| Un importe | El importe | Sí |
| Pendiente | *Cotizar* | No |
| Caso por caso | *Cotizar* | No |
| No aplica | *No aplica*, en gris | No |
| Vacío | — | No |

**Nunca imprime $0.** Un cero se lee como "gratis" y ésa es exactamente la
factura que nadie quiere mandar.

### Si dos personas abren la misma cotización

La que guarde primero, guarda. La otra ve un aviso diciendo quién se le adelantó
y deja de guardar para no pisar su trabajo. **Lo que escribiste sigue en
pantalla**: cópialo si lo necesitas y vuelve a cargar.

### En el iPad y en el celular

En pantallas chicas la cuadrícula y el documento se alternan con los botones
**Precios** / **Documento** de arriba. En iPad horizontal y en la computadora se
ven los dos a la vez.

---

## El tarifario

**Tarifario** son los precios de lista: la matriz completa de talentos por
formatos.

- **Buscar** filtra por nombre o por código (`KT-004`).
- **Formatos** reduce las columnas a una categoría — con 19 no cabe nada.
- Escribe un precio y se guarda solo.
- El desplegable de abajo marca la celda como *Pendiente*, *Caso por caso* o
  *No aplica*.

Lo que cambies aquí es el precio de partida de las cotizaciones **nuevas**. Las
que ya están armadas conservan el suyo: subir un precio no reescribe lo que ya
le mandaste a una marca.

Un precio que cambies aquí queda marcado como editado a mano, y la próxima vez
que importes el Excel **no lo va a pisar**: aparecerá como conflicto para que
alguien decida.

---

## Traer datos del CRM

**Importar** → elige el `.xlsx`.

El sistema lee el archivo y te enseña **qué cambiaría**. Todavía no ha tocado
nada. Revisa:

- **Hojas leídas** — en qué fila encontró el encabezado de cada una. Los
  archivos reales las tienen en filas distintas; si alguna se ve mal, párate
  aquí.
- **Nombres que no coinciden** — el archivo escribe un nombre que no reconoce.
  Confirma a quién corresponde: la decisión se guarda y la próxima vez no
  vuelve a preguntar.
- **Precios que se editaron en la app** — el archivo trae algo distinto de lo
  que alguien ajustó a mano. Por omisión **se conserva lo de la app**; cámbialo
  sólo si el Excel está más al día.
- **Filas que no se pudieron colocar** — tienen datos pero no dicen de quién
  son. No se descartan: aquí está el contenido crudo para que las busques en el
  Excel.

Cuando estés conforme: **Aplicar al tarifario**. Eso sí escribe, y lo hace un
administrador.

Volver a subir el mismo archivo es seguro — dirá "Este archivo no cambia nada".

Un talento que el archivo no traiga **no se borra**: queda señalado. Que falte
en un Excel no significa que haya dejado la agencia.

---

## Talentos

**Talentos** muestra una ficha por cada uno: sus tarifas, su audiencia, el
ángulo comercial que escribieron en el CRM y todos los nombres con los que
aparece en los archivos.

Dos cosas que ahorran disgustos:

- Junto a cada cifra de seguidores está **el valor tal como venía en el
  archivo** (`"99.1.K"`, `"48.9K aprox. — validar"`). El número interpretado no
  basta para decidir si fiarse.
- La cifra de **alcance** suma los seguidores de todas las plataformas, así que
  cuenta a la misma persona varias veces. Es alcance, no audiencia única. No la
  presentes como si lo fuera.

Si un talento es **menor de edad**, la ficha lo dice y advierte que hace falta
consentimiento del tutor y revisión legal. No se guarda ningún dato personal
suyo.

---

## Bitácora

**Bitácora** guarda todo lo que se cambia: quién, cuándo, y de qué valor a cuál.

> *Chuy Gallardo ajustó Ronny · TikTok + réplica en Reel de $195,000 a $150,000*

Se filtra por categoría, por persona y por texto — busca `HONOR` o `Ronny` o una
cifra. La casilla **Sólo intentos denegados** muestra lo que alguien intentó
hacer sin tener permiso.

No se puede borrar. Es la respuesta a "¿quién cambió esto?" seis meses después.

---

## Roles

| Rol | Qué puede |
|---|---|
| **Administrador** | Todo |
| **Comercial** | Crear y editar sus cotizaciones, el tarifario, subir archivos, ver la bitácora |
| **Solo lectura** | Consultar y descargar PDFs |

La barra de arriba muestra tu rol. Si un botón no aparece, es por eso — no es
que el sistema falle.

---

## Preguntas frecuentes

**Cambié un precio en el tarifario. ¿Se actualizan las cotizaciones que ya hice?**
No, y es deliberado. Cada cotización congela sus precios al crearse. Así lo que
ya mandaste sigue diciendo lo que decía.

**Me equivoqué en un precio de una cotización.**
Escríbelo bien encima, o usa ⋯ → *Volver al tarifario* para dejarlo como el
precio de lista.

**Bajé el PDF y quiero cambiarle algo.**
Cambia lo que sea y vuelve a bajarlo. Mientras la cotización siga en borrador se
puede editar cuantas veces haga falta.

**Se me olvidó mi contraseña.**
Un administrador te pone una nueva desde **Usuarios** → *Reiniciar su
contraseña*. Te la dice en persona y tú eliges la definitiva al entrar.

**Me equivoqué ocho veces con la contraseña y ya no me deja.**
Espera 15 minutos, o pídele a un administrador que te la reinicie — eso también
levanta el bloqueo.

**¿Puedo mandarle a la marca un enlace en vez del PDF?**
Todavía no. De momento se manda el PDF, que es lo que ya hacían.
