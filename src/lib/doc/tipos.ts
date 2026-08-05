/**
 * El payload del documento: TODO lo que hace falta para dibujarlo.
 *
 * Es autosuficiente a propósito — incluye el logo como data: URI y los textos
 * ya resueltos. El renderizador no consulta la base ni la red, así que un
 * documento emitido se puede volver a dibujar años después exactamente igual,
 * aunque el tarifario haya cambiado veinte veces.
 *
 * Es también lo que se congela en QuoteSnapshot.payload al emitir.
 */

export type EstadoPrecioDoc =
  | 'QUOTED'
  | 'PENDING'
  | 'NOT_APPLICABLE'
  | 'CASE_BY_CASE'

export interface CeldaPrecio {
  /** Centavos. `null` cuando el estado no es QUOTED. */
  amountCents: number | null
  status: EstadoPrecioDoc
  /** Se ajustó respecto al tarifario: la UI lo marca (el PDF no). */
  ajustado?: boolean
}

export interface ColumnaDoc {
  /** Primera línea del encabezado, p. ej. "TIKTOK + REEL". */
  label: string
  /** Segunda línea centrada, p. ej. "(ESPEJO)". */
  sublabel?: string
}

export interface FilaTalentoDoc {
  nombre: string
  celdas: CeldaPrecio[]
}

export interface MetaDoc {
  /** Etiqueta y valor de cada campo de la caja superior. */
  etiqueta: string
  valor: string
}

export interface DocumentoTabulador {
  tipo: 'TABULADOR'
  /** "KATANA TALENT" — la línea pequeña sobre el título. */
  eyebrow: string
  titulo: string
  /** Nombre del cliente; aparece en el encabezado de la página 2. */
  cliente: string
  /** Cuatro campos: CLIENTE, CONTACTO, AGENTE, MONEDA. */
  meta: MetaDoc[]
  columnas: ColumnaDoc[]
  /**
   * Centros de cada columna de precio, en puntos desde el borde de la página.
   *
   * El tabulador original los tiene ajustados a mano (60, 88, 119 y 151 mm
   * desde el borde de la caja), no repartidos por igual. Si se omite, se
   * calcula un reparto equitativo, que es lo razonable para un documento nuevo.
   */
  centrosColumna?: number[]
  filas: FilaTalentoDoc[]
  tituloConsideraciones: string
  consideraciones: string[]
  tituloTerminos: string
  terminos: string[]
  confidencialidadTitulo: string
  confidencialidadTexto: string
  firma: string
  piePagina: string
  /** PNG del logo como data: URI. El documento no pide nada por red. */
  logoDataUri: string
  /**
   * Qué imprimir cuando no hay importe. Se decide por documento: lo que ve la
   * marca no es un detalle técnico.
   */
  textoPendiente: string
  textoCasoPorCaso: string
  textoNoAplica: string
  textoVacio: string
  /** Los importes del original van en azul marino; se puede pasar a morado. */
  preciosEnMorado: boolean
}

export type Documento = DocumentoTabulador

export type ModoRender = 'preview' | 'print'
