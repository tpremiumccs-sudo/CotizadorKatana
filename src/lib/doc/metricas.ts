import anchosJson from './anchos.json'
import metricasJson from './metricas.json'

/**
 * Geometría del documento y medición de texto.
 *
 * Se separan dos cosas que no son lo mismo:
 *
 *   · `LAYOUT` — la estructura invariante: márgenes, alturas de fila, pasos
 *     verticales. Vale para cualquier cotización, con 4 talentos o con 21.
 *   · `GOLDEN_HONOR` — las coordenadas exactas del tabulador de HONOR, que es
 *     el fixture contra el que se demuestra la fidelidad. Mezclarlas haría que
 *     "reproducir el fixture" y "maquetar bien" fueran lo mismo, y con 21
 *     talentos dejarían de serlo.
 *
 * Todos los valores salen de MEDIR el PDF original con pdfplumber, no de
 * transcribirlos: ver tools/huella.py y tools/calibrar.py.
 */

// ─────────────────────────── Página ───────────────────────────

export const PAGINA = {
  ancho: 612,
  alto: 792,
} as const

// ─────────────────────────── Colores ───────────────────────────

export const COLOR = {
  /** Morado de marca: barra superior, viñetas, marcadores de lista. */
  marca: '#7B2FBE',
  /** Morado oscuro: títulos y nombres de talento. */
  oscuro: '#3D0070',
  /** Azul marino de los importes. Así está en el original. */
  precio: '#1E3A8A',
  /** Tinte lila de cajas y filas alternas. */
  tinte: '#FBF9FE',
  /** Borde lila. */
  borde: '#E4DBF0',
  /** Gris-lila de etiquetas y pie. */
  etiqueta: '#9A92A6',
  /** Texto de cuerpo. */
  texto: '#1C1326',
  /** Gris del bloque de confidencialidad. */
  gris: '#5E5566',
  blanco: '#FFFFFF',
} as const

// ─────────────────────────── Estructura invariante ───────────────────────────

export const LAYOUT = {
  /** Barra morada superior, a sangre. */
  barraSuperiorAlto: 17.008,

  /** Margen izquierdo del bloque de texto (títulos, listas, pie). */
  margenIzq: 40.016,
  /** Sangría de viñetas y marcadores de lista. */
  sangriaLista: 52.016,
  /** Margen del pie y de la línea que lo separa. */
  margenPie: 34.016,
  anchoPie: 543.968, // 577.984 − 34.016

  /** Caja de metadatos y tabla comparten estos bordes. */
  cajaIzq: 70.724,
  cajaDer: 541.276,

  // ── Encabezado ──
  eyebrowTop: 200.474,
  eyebrowTam: 8.3,
  tituloTop: 213.689,
  tituloTam: 19,

  // ── Logo ──
  logoIzq: 34.016,
  logoTop: 42.52,
  logoAncho: 119.055,
  logoAlto: 41.843,

  // ── Caja de metadatos ──
  metaTop: 236.756,
  metaAlto: 54,
  metaFilaAlto: 27,
  metaEtiquetaTam: 7.2,
  metaValorTam: 10,
  /** Desplazamientos desde el borde de la caja, medidos en el original. */
  metaEtiquetaIzq: [79.724, 312.165],
  metaValorIzq: [147.756, 385.866],
  /** La etiqueta va 0.92 pt más abajo que el valor por su tamaño menor. */
  metaEtiquetaDesfase: 9.99,
  metaValorDesfase: 9.07,

  // ── Tabla ──
  tablaTop: 302.756,
  encabezadoAlto: 37,
  filaAlto: 28.5,
  encabezadoTam: 8.3,
  /** Encabezado de una sola línea: desplazamiento desde el borde superior. */
  encabezadoUnaLinea: 14.968,
  /** De dos líneas: primera y segunda. */
  encabezadoDosLineas: [9.718, 20.218],
  nombreTam: 9.7,
  precioTam: 9.6,
  /** Desde el borde superior de la fila hasta la línea de texto. */
  filaTextoDesfase: 10.008,
  precioTextoDesfase: 9.987,
  /** El nombre del talento arranca 8 pt dentro de la caja. */
  nombreIzq: 78.724,

  // ── Consideraciones y términos ──
  seccionTituloTam: 13.5,
  /** Espacio entre el final de la tabla y el título de Consideraciones. */
  tablaATitulo: 14.794,
  /** Del título a la primera viñeta. */
  tituloAPrimeraLinea: 21.069,
  /** Paso entre viñetas y entre puntos de la lista numerada. */
  pasoLista: 15.8,
  /** Paso entre líneas dentro de un mismo punto que se parte. */
  pasoContinuacion: 13.2,
  listaTam: 9,
  /** De la última línea de Consideraciones al título de Términos. */
  seccionASeccion: 26.731,

  // ── Pie ──
  pieLineaTop: 760.819,
  pieLineaGrosor: 0.7,
  pieTextoTop: 765.189,
  pieTam: 7,

  // ── Página 2 ──
  logo2Izq: 34.016,
  logo2Top: 31.181,
  logo2Ancho: 68,
  logo2Alto: 23.9,
  cabecera2Top: 26.189,
  cabecera2Tam: 7,
  cabecera2LineaTop: 36.919,
  /** Primera línea de contenido en la página 2. */
  contenidoTop: 127.019,

  // ── Bloque de confidencialidad ──
  confidencialTam: 8.2,
  confidencialPasoLinea: 11,
  confidencialPadIzq: 10,
  confidencialPadTop: 10,
  /** Barra morada vertical, centrada en el borde izquierdo. */
  confidencialBarraGrosor: 3,

  firmaTam: 7.6,
} as const

/**
 * Coordenadas exactas del tabulador de HONOR.
 *
 * Sólo se usan para reproducir el fixture en la prueba de fidelidad. El
 * documento real las calcula a partir de LAYOUT.
 */
export const GOLDEN_HONOR = {
  /** Centros de las 4 columnas de precio, medidos en el original. */
  centrosColumna: [240.803, 320.173, 408.047, 498.756],
  filasTop: [339.756, 368.256, 396.756, 425.256],
  tablaFin: 453.756,
  consideracionesTop: 468.55,
  primeraVinetaTop: 489.619,
  terminosTop: 642.75,
  primerTerminoTop: 663.819,
} as const

// ─────────────────────────── Medición de texto ───────────────────────────

type Estilo = 'Regular' | 'Bold'

const ANCHOS = anchosJson.anchos as Record<Estilo, Record<string, number>>

/**
 * Desfases de línea base, re-indexados.
 *
 * El JSON lo escribe Python, que serializa 19 como "19.0"; JavaScript compone
 * la clave con "19". Se normaliza el número al cargar para que ambos mundos
 * usen el mismo índice.
 */
const DESFASE: Record<string, number> = Object.fromEntries(
  Object.entries(metricasJson.desfaseLineaBase as Record<string, number>).map(
    ([clave, valor]) => {
      const [estilo, tam] = clave.split('@')
      return [`${estilo}@${Number(tam)}`, valor]
    },
  ),
)

/**
 * Ancho de una cadena en puntos.
 *
 * Usa la tabla de avances generada por tools/calibrar.py, que verificó contra
 * Chromium que el error acumulado en una línea completa queda por debajo del
 * 0.17 %. Al ser una función pura sin DOM, el servidor y el navegador miden
 * exactamente igual — que es lo que permite paginar sin renderizar.
 */
export function anchoTexto(texto: string, tam: number, estilo: Estilo = 'Regular'): number {
  const tabla = ANCHOS[estilo]
  // Un glifo que no esté en el subset se aproxima con el de la interrogación:
  // es preferible un ancho aproximado a un NaN que rompa la paginación.
  const porOmision = tabla['?'] ?? 556
  let total = 0
  for (const c of texto) total += tabla[c] ?? porOmision
  return (total * tam) / 1000
}

/**
 * `top` de CSS que reproduce una coordenada medida en el PDF.
 *
 * Chromium sitúa la línea base en función de las métricas verticales de la
 * fuente y luego la cuantiza al píxel CSS (0.75 pt). El desfase por
 * (estilo, tamaño) lo mide tools/calibrar.py; la dispersión comprobada es de
 * 0.640 pt, dentro de la tolerancia de 1.0 pt del oráculo.
 */
export function cssTop(topPdf: number, tam: number, estilo: Estilo = 'Regular'): number {
  const clave = `${estilo}@${tam}`
  const d = DESFASE[clave]
  if (d === undefined) {
    throw new Error(
      `No hay calibración para ${clave}. Añádelo a SONDAS en tools/calibrar.py ` +
        'y vuelve a ejecutar `npm run calibrar`.',
    )
  }
  return Number((topPdf - d).toFixed(3))
}

/** `left` de CSS para centrar una cadena en un punto dado. */
export function centrar(centro: number, texto: string, tam: number, estilo: Estilo): number {
  return Number((centro - anchoTexto(texto, tam, estilo) / 2).toFixed(3))
}

/** `left` de CSS para alinear una cadena a la derecha de un punto. */
export function alinearDerecha(
  derecha: number,
  texto: string,
  tam: number,
  estilo: Estilo,
): number {
  return Number((derecha - anchoTexto(texto, tam, estilo)).toFixed(3))
}

/**
 * Parte un texto en líneas que quepan en un ancho dado.
 *
 * Determinista y sin DOM: el mismo texto da el mismo corte en el servidor y en
 * el iPad. Si el navegador partiera por su cuenta, la vista previa y el PDF
 * podrían tener distinto número de líneas y la paginación divergiría.
 */
export function partirEnLineas(
  texto: string,
  anchoMax: number,
  tam: number,
  estilo: Estilo = 'Regular',
  /**
   * Ancho disponible en la PRIMERA línea, cuando difiere del resto.
   *
   * En la lista numerada la primera línea arranca después del marcador ("1." y
   * dos espacios) mientras que las siguientes vuelven al margen. Sin distinguir
   * ambos anchos, el corte cae una palabra más tarde de lo que debe.
   */
  anchoPrimera: number = anchoMax,
): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return ['']

  const lineas: string[] = []
  let actual = ''
  let disponible = anchoPrimera

  for (const palabra of palabras) {
    const tentativa = actual === '' ? palabra : `${actual} ${palabra}`
    if (anchoTexto(tentativa, tam, estilo) <= disponible || actual === '') {
      actual = tentativa
    } else {
      lineas.push(actual)
      actual = palabra
      disponible = anchoMax
    }
  }
  if (actual !== '') lineas.push(actual)
  return lineas
}
