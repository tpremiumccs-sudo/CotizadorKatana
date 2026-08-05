import type { Documento, DocumentoTabulador, CeldaPrecio, ModoRender } from './tipos'
import {
  PAGINA, COLOR, LAYOUT,
  anchoTexto, cssTop, centrar, alinearDerecha, partirEnLineas,
} from './metricas'
import { formatMXN } from '@/lib/money'

/**
 * Renderiza el documento a HTML.
 *
 * ⚠ ÉSTA ES LA ÚNICA DEFINICIÓN DEL DOCUMENTO. La vista previa la pinta en un
 * <iframe> y el PDF la imprime con Chromium: mismo HTML, mismas fuentes, mismo
 * resultado. No hay dos implementaciones que puedan divergir, que es justo lo
 * que el usuario pidió cuando dijo que al modificar algo en el cotizador se
 * modificara igual en el PDF.
 *
 * Es una función pura que devuelve una cadena. No usa React a propósito: para
 * trabajo de precisión tipográfica, generar la cadena elimina toda una clase de
 * problemas (hidratación, reconciliación, diferencias servidor/cliente) y es lo
 * bastante rápida como para re-ejecutarla en cada tecla del editor.
 *
 * Todo se posiciona en absoluto, en puntos, dentro de hojas de 612×792 pt. No
 * se deja fluir nada al navegador: el paginado es nuestro y por eso el número
 * de páginas es predecible y verificable.
 */

const FUENTE = 'KatanaSans'

interface Fuentes {
  regularWoff2Base64: string
  boldWoff2Base64: string
}

type Estilo = 'Regular' | 'Bold'

// ─────────────────────────── utilidades ───────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const n = (v: number) => Number(v.toFixed(3))

interface OpcionesTexto {
  left: number
  /** Coordenada `top` MEDIDA EN EL PDF; se convierte a CSS con la calibración. */
  topPdf: number
  tam: number
  estilo?: Estilo
  color: string
  /** Espaciado entre letras, para el eyebrow. */
  tracking?: number
  ancla?: string
}

function texto(contenido: string, o: OpcionesTexto): string {
  const estilo = o.estilo ?? 'Regular'
  const peso = estilo === 'Bold' ? 700 : 400
  const top = cssTop(o.topPdf, o.tam, estilo)
  const tracking = o.tracking ? `letter-spacing:${n(o.tracking)}pt;` : ''
  const ancla = o.ancla ? ` data-ancla="${esc(o.ancla)}"` : ''
  return (
    `<div class="t"${ancla} style="left:${n(o.left)}pt;top:${n(top)}pt;` +
    `font-size:${n(o.tam)}pt;font-weight:${peso};color:${o.color};${tracking}">` +
    `${esc(contenido)}</div>`
  )
}

function rect(
  x0: number, top: number, x1: number, bottom: number, relleno: string,
): string {
  return (
    `<div class="r" style="left:${n(x0)}pt;top:${n(top)}pt;` +
    `width:${n(x1 - x0)}pt;height:${n(bottom - top)}pt;background:${relleno};"></div>`
  )
}

/** Línea horizontal centrada en `y`, como un trazo de PDF. */
function lineaH(x0: number, x1: number, y: number, grosor: number, color: string): string {
  return rect(x0, y - grosor / 2, x1, y + grosor / 2, color)
}

/** Línea vertical centrada en `x`. */
function lineaV(x: number, top: number, bottom: number, grosor: number, color: string): string {
  return rect(x - grosor / 2, top, x + grosor / 2, bottom, color)
}

/** Marco de un rectángulo, dibujado como cuatro trazos centrados en el borde. */
function marco(
  x0: number, top: number, x1: number, bottom: number, grosor: number, color: string,
): string {
  return [
    lineaH(x0, x1, top, grosor, color),
    lineaH(x0, x1, bottom, grosor, color),
    lineaV(x0, top, bottom, grosor, color),
    lineaV(x1, top, bottom, grosor, color),
  ].join('')
}

// ─────────────────────────── contenido del documento ───────────────────────────

/** Qué se imprime en una celda de precio. */
export function textoCelda(celda: CeldaPrecio, doc: DocumentoTabulador): string {
  switch (celda.status) {
    case 'QUOTED':
      return celda.amountCents === null ? doc.textoVacio : formatMXN(celda.amountCents)
    case 'PENDING':
      return doc.textoPendiente
    case 'CASE_BY_CASE':
      return doc.textoCasoPorCaso
    case 'NOT_APPLICABLE':
      return doc.textoNoAplica
    default:
      return doc.textoVacio
  }
}

/** Un precio sin importe se imprime en gris: no es una cifra. */
function colorCelda(celda: CeldaPrecio, doc: DocumentoTabulador): string {
  if (celda.status === 'QUOTED' && celda.amountCents !== null) {
    return doc.preciosEnMorado ? COLOR.oscuro : COLOR.precio
  }
  return COLOR.etiqueta
}

/** Centros de columna a partir del ancho disponible. */
export function centrosColumna(numColumnas: number): number[] {
  // La primera columna (TALENTO) ocupa el 30 % y el resto se reparte el 70 %.
  const izq = LAYOUT.cajaIzq
  const ancho = LAYOUT.cajaDer - LAYOUT.cajaIzq
  const anchoTalento = ancho * 0.3
  const restante = ancho - anchoTalento
  const paso = restante / numColumnas
  return Array.from(
    { length: numColumnas },
    (_, i) => izq + anchoTalento + paso * i + paso / 2,
  )
}

// ─────────────────────────── paginación ───────────────────────────

/**
 * Un punto de la lista numerada, ya partido en líneas.
 * Nunca se corta entre páginas: se mueve entero.
 */
interface PuntoLista {
  marcador: string
  lineas: string[]
}

/** Línea de contenido que ya no puede bajar más sin chocar con el pie. */
const LIMITE_CONTENIDO = 748

/** Margen derecho del bloque de texto. */
const DERECHA = 577.984
/** Las continuaciones vuelven al margen de la lista: no hay sangría francesa. */
const ANCHO_LISTA = DERECHA - LAYOUT.sangriaLista
/**
 * La primera línea arranca después del marcador ("1.") y sus dos espacios de
 * separación, así que dispone de menos ancho. Medirlo igual que el resto corre
 * el corte una palabra y cambia el número de líneas — y con él, la paginación.
 */
const SEPARACION_MARCADOR = 2

export interface PaginaTabulador {
  /** Índice de los puntos de Términos que van en esta página. */
  terminos: Array<{ punto: PuntoLista; top: number }>
  /** La primera página lleva encabezado, tabla y consideraciones. */
  esPrimera: boolean
  /** El bloque de confidencialidad y la firma van en la última. */
  esUltima: boolean
}

export function paginar(doc: DocumentoTabulador): PaginaTabulador[] {
  const puntos: PuntoLista[] = doc.terminos.map((t, i) => {
    const marcador = `${i + 1}.`
    const inicioTexto =
      LAYOUT.sangriaLista +
      anchoTexto(marcador, LAYOUT.listaTam, 'Bold') +
      anchoTexto(' '.repeat(SEPARACION_MARCADOR), LAYOUT.listaTam, 'Regular')
    return {
      marcador,
      lineas: partirEnLineas(
        t, ANCHO_LISTA, LAYOUT.listaTam, 'Regular', DERECHA - inicioTexto,
      ),
    }
  })

  // ── Página 1: dónde termina lo que va antes de los Términos ────────────
  const tablaFin =
    LAYOUT.tablaTop + LAYOUT.encabezadoAlto + doc.filas.length * LAYOUT.filaAlto
  const considTitulo = tablaFin + LAYOUT.tablaATitulo
  const primeraVineta = considTitulo + LAYOUT.tituloAPrimeraLinea
  const ultimaVineta = primeraVineta + (doc.consideraciones.length - 1) * LAYOUT.pasoLista
  const terminosTitulo = ultimaVineta + LAYOUT.seccionASeccion
  let cursor = terminosTitulo + LAYOUT.tituloAPrimeraLinea

  const paginas: PaginaTabulador[] = []
  let actual: PaginaTabulador = { terminos: [], esPrimera: true, esUltima: false }

  for (const punto of puntos) {
    const altura = (punto.lineas.length - 1) * LAYOUT.pasoContinuacion
    // Un punto no se parte entre páginas: o cabe entero o baja completo.
    if (cursor + altura > LIMITE_CONTENIDO) {
      paginas.push(actual)
      actual = { terminos: [], esPrimera: false, esUltima: false }
      cursor = LAYOUT.contenidoTop
    }
    actual.terminos.push({ punto, top: cursor })
    cursor += altura + LAYOUT.pasoLista
  }

  paginas.push(actual)

  // El bloque de confidencialidad va tras el último punto; si no cabe, abre
  // una página más para que no quede partido.
  const ultimo = actual.terminos[actual.terminos.length - 1]
  const finTerminos = ultimo
    ? ultimo.top + (ultimo.punto.lineas.length - 1) * LAYOUT.pasoContinuacion
    : LAYOUT.contenidoTop
  const ALTO_CIERRE = 23.937 + 39.2 + 11.573 + 8 // caja + firma
  if (finTerminos + ALTO_CIERRE > LIMITE_CONTENIDO) {
    paginas.push({ terminos: [], esPrimera: false, esUltima: true })
  } else {
    paginas[paginas.length - 1]!.esUltima = true
  }

  return paginas
}

// ─────────────────────────── render de cada bloque ───────────────────────────

function encabezadoPrimera(doc: DocumentoTabulador): string {
  const p: string[] = []

  p.push(rect(0, 0, PAGINA.ancho, LAYOUT.barraSuperiorAlto, COLOR.marca))
  p.push(
    `<img class="logo" src="${doc.logoDataUri}" alt="" style="left:${LAYOUT.logoIzq}pt;` +
      `top:${LAYOUT.logoTop}pt;width:${LAYOUT.logoAncho}pt;height:${LAYOUT.logoAlto}pt;">`,
  )

  // El eyebrow lleva espaciado entre letras; se compensa el que sobra al final
  // para que el ancho medido coincida con el original.
  const trackingEyebrow =
    (110.093 - 40.016 - anchoTexto(doc.eyebrow, LAYOUT.eyebrowTam, 'Bold')) /
    Math.max(doc.eyebrow.length, 1)
  p.push(
    texto(doc.eyebrow, {
      left: LAYOUT.margenIzq, topPdf: LAYOUT.eyebrowTop, tam: LAYOUT.eyebrowTam,
      estilo: 'Bold', color: COLOR.marca, tracking: trackingEyebrow, ancla: 'eyebrow',
    }),
  )
  p.push(
    texto(doc.titulo, {
      left: LAYOUT.margenIzq, topPdf: LAYOUT.tituloTop, tam: LAYOUT.tituloTam,
      estilo: 'Bold', color: COLOR.oscuro, ancla: 'titulo',
    }),
  )
  return p.join('')
}

function cajaMetadatos(doc: DocumentoTabulador): string {
  const p: string[] = []
  const top = LAYOUT.metaTop
  const bottom = top + LAYOUT.metaAlto

  p.push(rect(LAYOUT.cajaIzq, top, LAYOUT.cajaDer, bottom, COLOR.tinte))
  p.push(marco(LAYOUT.cajaIzq, top, LAYOUT.cajaDer, bottom, 0.6, COLOR.borde))
  p.push(
    lineaH(LAYOUT.cajaIzq, LAYOUT.cajaDer, top + LAYOUT.metaFilaAlto, 0.5, COLOR.borde),
  )

  doc.meta.forEach((m, i) => {
    const fila = Math.floor(i / 2)
    const col = i % 2
    const filaTop = top + fila * LAYOUT.metaFilaAlto
    p.push(
      texto(m.etiqueta, {
        left: LAYOUT.metaEtiquetaIzq[col]!,
        topPdf: filaTop + LAYOUT.metaEtiquetaDesfase,
        tam: LAYOUT.metaEtiquetaTam, estilo: 'Bold', color: COLOR.etiqueta,
      }),
    )
    p.push(
      texto(m.valor, {
        left: LAYOUT.metaValorIzq[col]!,
        topPdf: filaTop + LAYOUT.metaValorDesfase,
        tam: LAYOUT.metaValorTam, estilo: 'Bold', color: COLOR.oscuro,
        ancla: `meta-${i}`,
      }),
    )
  })
  return p.join('')
}

function tabla(doc: DocumentoTabulador): string {
  const p: string[] = []
  const top = LAYOUT.tablaTop
  const encabezadoFin = top + LAYOUT.encabezadoAlto
  const centros = doc.centrosColumna ?? centrosColumna(doc.columnas.length)

  // Encabezado morado.
  p.push(rect(LAYOUT.cajaIzq, top, LAYOUT.cajaDer, encabezadoFin, COLOR.marca))
  p.push(
    texto('TALENTO', {
      left: LAYOUT.nombreIzq, topPdf: top + LAYOUT.encabezadoUnaLinea,
      tam: LAYOUT.encabezadoTam, estilo: 'Bold', color: COLOR.blanco,
    }),
  )
  doc.columnas.forEach((c, i) => {
    const centro = centros[i]!
    if (c.sublabel) {
      // Celda de dos líneas, centradas verticalmente sobre la de una línea.
      p.push(
        texto(c.label, {
          left: centrar(centro, c.label, LAYOUT.encabezadoTam, 'Bold'),
          topPdf: top + LAYOUT.encabezadoDosLineas[0]!,
          tam: LAYOUT.encabezadoTam, estilo: 'Bold', color: COLOR.blanco,
        }),
      )
      p.push(
        texto(c.sublabel, {
          left: centrar(centro, c.sublabel, LAYOUT.encabezadoTam, 'Bold'),
          topPdf: top + LAYOUT.encabezadoDosLineas[1]!,
          tam: LAYOUT.encabezadoTam, estilo: 'Bold', color: COLOR.blanco,
        }),
      )
    } else {
      p.push(
        texto(c.label, {
          left: centrar(centro, c.label, LAYOUT.encabezadoTam, 'Bold'),
          topPdf: top + LAYOUT.encabezadoUnaLinea,
          tam: LAYOUT.encabezadoTam, estilo: 'Bold', color: COLOR.blanco,
        }),
      )
    }
  })

  // Filas, con cebra por índice global.
  doc.filas.forEach((fila, i) => {
    const filaTop = encabezadoFin + i * LAYOUT.filaAlto
    const filaFin = filaTop + LAYOUT.filaAlto
    p.push(
      rect(LAYOUT.cajaIzq, filaTop, LAYOUT.cajaDer, filaFin,
        i % 2 === 0 ? COLOR.blanco : COLOR.tinte),
    )
    if (i > 0) {
      p.push(lineaH(LAYOUT.cajaIzq, LAYOUT.cajaDer, filaTop, 0.4, COLOR.borde))
    }
    p.push(
      texto(fila.nombre, {
        left: LAYOUT.nombreIzq, topPdf: filaTop + LAYOUT.filaTextoDesfase,
        tam: LAYOUT.nombreTam, estilo: 'Bold', color: COLOR.oscuro,
        ancla: `talento-${i}`,
      }),
    )
    fila.celdas.forEach((celda, j) => {
      const t = textoCelda(celda, doc)
      if (!t) return
      p.push(
        texto(t, {
          left: centrar(centros[j]!, t, LAYOUT.precioTam, 'Bold'),
          topPdf: filaTop + LAYOUT.precioTextoDesfase,
          tam: LAYOUT.precioTam, estilo: 'Bold', color: colorCelda(celda, doc),
          ancla: `precio-${i}-${j}`,
        }),
      )
    })
  })

  const tablaFin = encabezadoFin + doc.filas.length * LAYOUT.filaAlto
  // Línea inferior: el original la lleva doble (0.6 del marco y 0.4 de fila).
  p.push(lineaH(LAYOUT.cajaIzq, LAYOUT.cajaDer, tablaFin, 0.4, COLOR.borde))
  p.push(marco(LAYOUT.cajaIzq, top, LAYOUT.cajaDer, tablaFin, 0.6, COLOR.borde))
  return p.join('')
}

function consideraciones(doc: DocumentoTabulador): string {
  const p: string[] = []
  const tablaFin =
    LAYOUT.tablaTop + LAYOUT.encabezadoAlto + doc.filas.length * LAYOUT.filaAlto
  const tituloTop = tablaFin + LAYOUT.tablaATitulo

  p.push(
    texto(doc.tituloConsideraciones, {
      left: LAYOUT.margenIzq, topPdf: tituloTop, tam: LAYOUT.seccionTituloTam,
      estilo: 'Bold', color: COLOR.oscuro,
    }),
  )

  const primera = tituloTop + LAYOUT.tituloAPrimeraLinea
  doc.consideraciones.forEach((c, i) => {
    const top = primera + i * LAYOUT.pasoLista
    // La viñeta y el texto arrancan en la misma x: en el original el glifo de
    // viñeta tiene avance cero y el texto lleva dos espacios de separación.
    p.push(
      texto('•', {
        left: LAYOUT.sangriaLista, topPdf: top, tam: LAYOUT.listaTam,
        color: COLOR.marca,
      }),
    )
    p.push(
      texto(`  ${c}`, {
        left: LAYOUT.sangriaLista, topPdf: top, tam: LAYOUT.listaTam,
        color: COLOR.texto, ancla: `consideracion-${i}`,
      }),
    )
  })
  return p.join('')
}

function tituloTerminos(doc: DocumentoTabulador): string {
  const tablaFin =
    LAYOUT.tablaTop + LAYOUT.encabezadoAlto + doc.filas.length * LAYOUT.filaAlto
  const considTitulo = tablaFin + LAYOUT.tablaATitulo
  const primeraVineta = considTitulo + LAYOUT.tituloAPrimeraLinea
  const ultimaVineta = primeraVineta + (doc.consideraciones.length - 1) * LAYOUT.pasoLista
  return texto(doc.tituloTerminos, {
    left: LAYOUT.margenIzq,
    topPdf: ultimaVineta + LAYOUT.seccionASeccion,
    tam: LAYOUT.seccionTituloTam, estilo: 'Bold', color: COLOR.oscuro,
  })
}

function terminosDePagina(pagina: PaginaTabulador): string {
  const p: string[] = []
  for (const { punto, top } of pagina.terminos) {
    // Sólo el marcador va en negrita morada; el cuerpo es regular oscuro.
    p.push(
      texto(punto.marcador, {
        left: LAYOUT.sangriaLista, topPdf: top, tam: LAYOUT.listaTam,
        estilo: 'Bold', color: COLOR.marca,
      }),
    )
    const inicioTexto =
      LAYOUT.sangriaLista + anchoTexto(punto.marcador, LAYOUT.listaTam, 'Bold')
    punto.lineas.forEach((linea, i) => {
      p.push(
        texto(i === 0 ? `  ${linea}` : linea, {
          // Sin sangría francesa: la continuación vuelve al margen de la lista.
          left: i === 0 ? inicioTexto : LAYOUT.sangriaLista,
          topPdf: top + i * LAYOUT.pasoContinuacion,
          tam: LAYOUT.listaTam, color: COLOR.texto,
        }),
      )
    })
  }
  return p.join('')
}

function cierre(doc: DocumentoTabulador, pagina: PaginaTabulador): string {
  const p: string[] = []
  const ultimo = pagina.terminos[pagina.terminos.length - 1]
  const finTerminos = ultimo
    ? ultimo.top + (ultimo.punto.lineas.length - 1) * LAYOUT.pasoContinuacion
    : LAYOUT.contenidoTop - LAYOUT.pasoLista

  const cajaTop = finTerminos + 23.937
  const cajaBottom = cajaTop + 39.2
  const izq = LAYOUT.margenPie
  const der = 577.984

  p.push(rect(izq, cajaTop, der, cajaBottom, COLOR.tinte))
  p.push(marco(izq, cajaTop, der, cajaBottom, 0.6, COLOR.borde))
  // Barra morada gruesa centrada en el borde izquierdo: sobresale 1.5 pt.
  p.push(lineaV(izq, cajaTop, cajaBottom, LAYOUT.confidencialBarraGrosor, COLOR.marca))

  const textoIzq = izq + LAYOUT.confidencialPadIzq
  const primeraLinea = cajaTop + 9.698
  const anchoTexto0 = der - textoIzq - LAYOUT.confidencialPadIzq

  const lead = doc.confidencialidadTitulo
  const anchoLead = anchoTexto(lead, LAYOUT.confidencialTam, 'Bold')
  const cuerpo = doc.confidencialidadTexto.replace('{CLIENTE}', doc.cliente)

  // La primera línea arranca después del lead en negrita, en la misma línea.
  const primeraDisponible = anchoTexto0 - anchoLead
  const palabras = cuerpo.split(/\s+/)
  const lineas: string[] = []
  let actual = ''
  let disponible = primeraDisponible
  for (const palabra of palabras) {
    const tentativa = actual === '' ? palabra : `${actual} ${palabra}`
    if (anchoTexto(tentativa, LAYOUT.confidencialTam) <= disponible || actual === '') {
      actual = tentativa
    } else {
      lineas.push(actual)
      actual = palabra
      disponible = anchoTexto0
    }
  }
  if (actual) lineas.push(actual)

  p.push(
    texto(lead, {
      left: textoIzq, topPdf: primeraLinea, tam: LAYOUT.confidencialTam,
      estilo: 'Bold', color: COLOR.gris,
    }),
  )
  lineas.forEach((l, i) => {
    p.push(
      texto(i === 0 ? ` ${l}` : l, {
        left: i === 0 ? textoIzq + anchoLead : textoIzq,
        topPdf: primeraLinea + i * LAYOUT.confidencialPasoLinea + (i > 0 ? 0.6 : 0),
        tam: LAYOUT.confidencialTam, color: COLOR.gris,
      }),
    )
  })

  p.push(
    texto(doc.firma, {
      left: LAYOUT.margenIzq, topPdf: cajaBottom + 11.573,
      tam: LAYOUT.firmaTam, color: COLOR.etiqueta,
    }),
  )
  return p.join('')
}

function cabeceraContinuacion(doc: DocumentoTabulador): string {
  const p: string[] = []
  p.push(
    `<img class="logo" src="${doc.logoDataUri}" alt="" style="left:${LAYOUT.logo2Izq}pt;` +
      `top:${LAYOUT.logo2Top}pt;width:${LAYOUT.logo2Ancho}pt;height:${LAYOUT.logo2Alto}pt;">`,
  )
  const t = `Katana Talent × ${doc.cliente}`
  p.push(
    texto(t, {
      left: alinearDerecha(577.984, t, LAYOUT.cabecera2Tam, 'Regular'),
      topPdf: LAYOUT.cabecera2Top, tam: LAYOUT.cabecera2Tam, color: COLOR.etiqueta,
    }),
  )
  p.push(
    lineaH(LAYOUT.margenPie, 577.984, LAYOUT.cabecera2LineaTop, 0.7, COLOR.borde),
  )
  return p.join('')
}

function pie(doc: DocumentoTabulador, numero: number, total: number): string {
  const p: string[] = []
  p.push(lineaH(LAYOUT.margenPie, 577.984, LAYOUT.pieLineaTop, LAYOUT.pieLineaGrosor, COLOR.borde))
  p.push(
    texto(doc.piePagina, {
      left: LAYOUT.margenPie, topPdf: LAYOUT.pieTextoTop, tam: LAYOUT.pieTam,
      color: COLOR.etiqueta,
    }),
  )
  // "Pág. N" con 2 páginas; "Pág. N de M" cuando hay más, para que quien lo
  // recibe sepa si le falta alguna.
  const etiqueta = total <= 2 ? `Pág. ${numero}` : `Pág. ${numero} de ${total}`
  p.push(
    texto(etiqueta, {
      left: alinearDerecha(577.984, etiqueta, LAYOUT.pieTam, 'Regular'),
      topPdf: LAYOUT.pieTextoTop, tam: LAYOUT.pieTam, color: COLOR.etiqueta,
    }),
  )
  return p.join('')
}

// ─────────────────────────── documento completo ───────────────────────────

export function cssDocumento(fuentes: Fuentes): string {
  return `
@font-face{font-family:'${FUENTE}';src:url(data:font/woff2;base64,${fuentes.regularWoff2Base64}) format('woff2');font-weight:400;font-style:normal;font-display:block;}
@font-face{font-family:'${FUENTE}';src:url(data:font/woff2;base64,${fuentes.boldWoff2Base64}) format('woff2');font-weight:700;font-style:normal;font-display:block;}
@page{size:8.5in 11in;margin:0;}
html,body{margin:0;padding:0;background:#fff;}
*{box-sizing:border-box;}
body{
  font-family:'${FUENTE}';
  font-kerning:none;
  font-variant-ligatures:none;
  font-feature-settings:'kern' 0,'liga' 0,'clig' 0,'calt' 0;
  text-rendering:geometricPrecision;
}
.pagina{
  position:relative;
  width:${PAGINA.ancho}pt;
  height:${PAGINA.alto}pt;
  overflow:hidden;
  background:#fff;
  break-after:page;
  page-break-after:always;
}
.pagina:last-child{break-after:auto;page-break-after:auto;}
.t{position:absolute;white-space:pre;line-height:1;margin:0;padding:0;}
.r{position:absolute;}
.logo{position:absolute;display:block;}
`.trim()
}

export function renderDocumentHtml(
  doc: Documento,
  fuentes: Fuentes,
  _modo: ModoRender = 'print',
): string {
  const paginas = paginar(doc)
  const total = paginas.length

  const cuerpo = paginas
    .map((pagina, i) => {
      const piezas: string[] = []
      if (pagina.esPrimera) {
        piezas.push(encabezadoPrimera(doc))
        piezas.push(cajaMetadatos(doc))
        piezas.push(tabla(doc))
        piezas.push(consideraciones(doc))
        piezas.push(tituloTerminos(doc))
      } else {
        piezas.push(cabeceraContinuacion(doc))
      }
      piezas.push(terminosDePagina(pagina))
      if (pagina.esUltima) piezas.push(cierre(doc, pagina))
      piezas.push(pie(doc, i + 1, total))
      return `<div class="pagina" data-pagina="${i + 1}">${piezas.join('')}</div>`
    })
    .join('')

  return (
    '<!doctype html><html lang="es-MX"><head><meta charset="utf-8">' +
    `<title>${esc(doc.titulo)} · ${esc(doc.cliente)}</title>` +
    `<style>${cssDocumento(fuentes)}</style></head><body>${cuerpo}</body></html>`
  )
}
