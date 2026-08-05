import type {
  DeteccionEncabezado,
  EspecificacionEncabezado,
  RejillaHoja,
  ValorCelda,
  ColumnaDetectada,
} from './types'

/**
 * Encuentra la fila de encabezados de una hoja.
 *
 * Hace falta porque en los archivos reales NO está siempre en el mismo sitio.
 * Medido:
 *
 *   TARIFARIO KATANA            → fila 0
 *   TALENTOS, CATALOGOS, KIF    → fila 0
 *   PERFIL COMERCIAL — CAPTURA  → fila 1 (la 0 es una instrucción larga)
 *   LEADS, PIPELINE, FIERA      → fila 1 (la 0 es una señalética o un título)
 *   Base de Talentos            → fila 3 (título, instrucción, vacía)
 *   Perfil comercial            → fila 3
 *
 * Codificar estos índices a mano funcionaría hasta que alguien inserte una fila
 * en el Excel, que es exactamente lo que pasa en un archivo vivo. Se detecta.
 */

const MAX_FILAS_ESCANEO = 8
const CONFIANZA_MINIMA = 0.6

/** `Última actualización` → `ultimaactualizacion`. */
export function normalizeHeader(crudo: string): string {
  return crudo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function textoCelda(v: ValorCelda): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v).trim()
}

function densidad(fila: ValorCelda[] | undefined): number {
  if (!fila || fila.length === 0) return 0
  const llenas = fila.filter((c) => textoCelda(c) !== '').length
  return llenas / Math.max(fila.length, 1)
}

/**
 * Una fila de instrucciones o de título no es un encabezado.
 *
 * Se reconocen por su forma: una sola celda con mucho texto ("Llena SOLO las
 * columnas D a H…"), o una celda que termina en dos puntos ("SEÑALÉTICA:").
 */
function pareceTituloOInstruccion(fila: ValorCelda[]): boolean {
  const llenas = fila.map(textoCelda).filter((t) => t !== '')
  if (llenas.length === 0) return true
  if (llenas.length === 1 && llenas[0]!.length > 40) return true
  if (llenas.some((t) => t.length > 90)) return true
  if (llenas[0]!.endsWith(':')) return true
  return false
}

/**
 * Filas de ejemplo que el propio Excel marca para borrar.
 *
 * La regla es deliberadamente estrecha: saltarse una fila de datos por error
 * la borra del sistema en silencio. Sólo cuenta como centinela lo que el
 * archivo marca de forma explícita — "EJEMPLO", "— borrar esta fila —" — o una
 * fila donde la MAYORÍA de las celdas son marcadores de posición `[…]`.
 */
export function esFilaCentinela(fila: ValorCelda[]): boolean {
  const textos = fila.map((c) => textoCelda(c).toLowerCase()).filter((t) => t !== '')
  if (textos.length === 0) return false

  if (
    textos.some(
      (t) => t === 'ejemplo' || t.includes('borrar esta fila') || t.includes('borrar —'),
    )
  ) {
    return true
  }

  // Marcadores de posición del tipo "[Qué hace, por qué importa…]". Se exige
  // que dominen la fila: una sola celda entre corchetes no basta.
  const marcadores = textos.filter(
    (t) => t.startsWith('[') && t.endsWith(']') && /[a-záéíóúñ]/.test(t),
  ).length
  return marcadores > 0 && marcadores >= textos.length / 2
}

export function detectHeaderRow(
  rejilla: RejillaHoja,
  spec: EspecificacionEncabezado,
  opciones: { maxFilasEscaneo?: number; confianzaMinima?: number } = {},
): DeteccionEncabezado {
  const maxFilas = opciones.maxFilasEscaneo ?? MAX_FILAS_ESCANEO
  const confianzaMinima = opciones.confianzaMinima ?? CONFIANZA_MINIMA

  // Índice de sinónimos → canónico.
  const canonicoPorNormalizado = new Map<string, string>()
  for (const req of spec.requeridos) {
    canonicoPorNormalizado.set(normalizeHeader(req), req)
  }
  for (const [canonico, formas] of Object.entries(spec.sinonimos ?? {})) {
    canonicoPorNormalizado.set(normalizeHeader(canonico), canonico)
    for (const f of formas) canonicoPorNormalizado.set(normalizeHeader(f), canonico)
  }

  let mejor: { fila: number; puntaje: number; columnas: ColumnaDetectada[] } | null = null

  const limite = Math.min(maxFilas, rejilla.filas.length)
  for (let i = 0; i < limite; i++) {
    const fila = rejilla.filas[i]
    if (!fila) continue
    if (pareceTituloOInstruccion(fila)) continue

    const columnas: ColumnaDetectada[] = []
    const encontrados = new Set<string>()

    for (let j = 0; j < fila.length; j++) {
      const crudo = textoCelda(fila[j])
      if (crudo === '') continue
      const canonico = canonicoPorNormalizado.get(normalizeHeader(crudo))
      if (canonico) {
        columnas.push({ indice: j, crudo, canonico, puntaje: 1 })
        encontrados.add(canonico)
      }
    }

    const cobertura = spec.requeridos.length
      ? spec.requeridos.filter((r) => encontrados.has(r)).length / spec.requeridos.length
      : 0
    const dens = densidad(fila)
    const densSiguiente = densidad(rejilla.filas[i + 1])

    // La cobertura manda; la densidad sólo desempata. Una fila con muchas
    // celdas llenas pero sin los encabezados esperados no es el encabezado.
    const puntaje = 0.8 * cobertura + 0.1 * dens + 0.1 * densSiguiente

    if (!mejor || puntaje > mejor.puntaje) {
      mejor = { fila: i, puntaje, columnas }
    }
  }

  if (!mejor) {
    return {
      filaEncabezado: 0,
      filaPrimerDato: 1,
      confianza: 0,
      columnas: [],
      requeridosFaltantes: [...spec.requeridos],
      columnasSinMapear: [],
      columnasSinEncabezado: [],
      requiereMapeoManual: true,
    }
  }

  const filaEncabezado = rejilla.filas[mejor.fila] ?? []
  const mapeadas = new Set(mejor.columnas.map((c) => c.indice))

  const columnasSinMapear: Array<{ indice: number; crudo: string }> = []
  for (let j = 0; j < filaEncabezado.length; j++) {
    const crudo = textoCelda(filaEncabezado[j])
    if (crudo !== '' && !mapeadas.has(j)) columnasSinMapear.push({ indice: j, crudo })
  }

  // Columnas CON datos pero SIN encabezado: en TALENTOS hay una banda así que
  // arrastra precios sueltos. Se reporta para que la UI la muestre, no se tira.
  const anchoMaximo = Math.max(
    filaEncabezado.length,
    ...rejilla.filas.slice(mejor.fila + 1).map((f) => f?.length ?? 0),
  )
  const columnasSinEncabezado: number[] = []
  for (let j = 0; j < anchoMaximo; j++) {
    if (textoCelda(filaEncabezado[j]) !== '') continue
    const tieneDatos = rejilla.filas
      .slice(mejor.fila + 1)
      .some((f) => textoCelda(f?.[j]) !== '')
    if (tieneDatos) columnasSinEncabezado.push(j)
  }

  // La primera fila de datos salta centinelas ("EJEMPLO", "— borrar esta fila —").
  let primerDato = mejor.fila + 1
  while (
    primerDato < rejilla.filas.length &&
    esFilaCentinela(rejilla.filas[primerDato] ?? [])
  ) {
    primerDato++
  }

  const encontrados = new Set(mejor.columnas.map((c) => c.canonico))
  return {
    filaEncabezado: mejor.fila,
    filaPrimerDato: primerDato,
    confianza: Number(mejor.puntaje.toFixed(4)),
    columnas: mejor.columnas,
    requeridosFaltantes: spec.requeridos.filter((r) => !encontrados.has(r)),
    columnasSinMapear,
    columnasSinEncabezado,
    requiereMapeoManual: mejor.puntaje < confianzaMinima,
  }
}

/** Índice de columna por encabezado canónico, para leer las filas de datos. */
export function indicePorCanonico(d: DeteccionEncabezado): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of d.columnas) if (!m.has(c.canonico)) m.set(c.canonico, c.indice)
  return m
}
