/**
 * Tipos del importador de Excel.
 *
 * El importador trabaja en tres fases y ninguna toca la base hasta la última:
 *
 *   leer   → una rejilla de celdas por hoja, sin interpretar
 *   planear→ qué cambiaría, con las dudas marcadas para que las resuelva un humano
 *   aplicar→ ejecuta el plan ya confirmado, de forma idempotente
 *
 * El motivo es concreto: los archivos reales traen encabezados en filas
 * distintas, filas huérfanas con datos, precios que son palabras y nombres que
 * no coinciden entre archivos. Aplicar directo significaría o romperse o —peor—
 * inventar datos en silencio.
 */

export type ValorCelda = string | number | boolean | Date | null | undefined

export interface RejillaHoja {
  nombre: string
  filas: ValorCelda[][]
}

export type EntidadHoja =
  | 'TARIFARIO'
  | 'PERFIL'
  | 'TALENTOS'
  | 'CATALOGOS'
  | 'PROPUESTAS'
  | 'ROSTER_BASE'
  | 'ROSTER_PERFIL'
  | 'KIF'
  | 'FIERA'

export interface EspecificacionEncabezado {
  entidad: EntidadHoja
  /** Nombre exacto de la hoja en el archivo. */
  hoja: string
  /** Encabezados que deben estar para dar la fila por buena. */
  requeridos: string[]
  /** Formas alternativas de escribir un encabezado. */
  sinonimos?: Record<string, string[]>
}

export interface ColumnaDetectada {
  indice: number
  crudo: string
  canonico: string
  puntaje: number
}

export interface DeteccionEncabezado {
  /** Índice 0. Medidos en los archivos reales: 0, 1 y 3 según la hoja. */
  filaEncabezado: number
  filaPrimerDato: number
  confianza: number
  columnas: ColumnaDetectada[]
  requeridosFaltantes: string[]
  columnasSinMapear: Array<{ indice: number; crudo: string }>
  /**
   * Columnas CON datos pero SIN encabezado. En la hoja TALENTOS hay una banda
   * así (columnas 11–20) que arrastra precios sueltos: se muestra en la UI en
   * vez de descartarse.
   */
  columnasSinEncabezado: number[]
  /** Por debajo del umbral: la UI pide mapeo manual. */
  requiereMapeoManual: boolean
}

// ─────────────────────────── Incidencias ───────────────────────────

export type CodigoIncidencia =
  | 'ENCABEZADO_NO_DETECTADO'
  | 'COLUMNA_REQUERIDA_FALTANTE'
  | 'FILA_HUERFANA'
  | 'BANDA_COLUMNAS_DESPLAZADA'
  | 'PRECIO_NO_RECONOCIDO'
  | 'PRECIO_SOSPECHOSO'
  | 'METRICA_INFERIDA'
  | 'METRICA_NO_RECONOCIDA'
  | 'METRICA_SOSPECHOSA'
  | 'IDENTIDAD_AMBIGUA'
  | 'TALENTO_AUSENTE'
  | 'CONFLICTO_EDICION_MANUAL'
  | 'HOJA_FALTANTE'

export type Severidad = 'INFO' | 'AVISO' | 'ERROR'

export interface Incidencia {
  codigo: CodigoIncidencia
  severidad: Severidad
  hoja: string
  /** Índice 0 dentro del archivo, para poder señalarla en la UI. */
  fila?: number
  columna?: number
  mensaje: string
  /** Volcado crudo de la fila: nada se descarta sin dejar rastro. */
  crudo?: unknown
}

// ─────────────────────────── Plan ───────────────────────────

export type AccionTalento = 'CREAR' | 'ACTUALIZAR' | 'SIN_CAMBIOS'

export interface CambioTarifa {
  deliverableCode: string
  deliverableNombre: string
  antesAmountCents: number | null
  antesPriceStatus: string | null
  despuesAmountCents: number | null
  despuesPriceStatus: string
  /** El precio se editó a mano en la app y el archivo trae otra cosa. */
  conflicto: boolean
  /** Qué hacer con el conflicto. Por omisión se conserva lo de la app. */
  resolucion?: 'CONSERVAR_APP' | 'TOMAR_ARCHIVO'
}

export interface EntradaPlanTalento {
  /** Nombre tal cual viene en el archivo. */
  crudo: string
  normalizado: string
  accion: AccionTalento
  talentIdExistente: string | null
  codigo: string | null
  displayName: string
  /** Resolución de identidad cuando no fue exacta. */
  identidad?: ResolucionIdentidad
  cambiosTalento: Record<string, { antes: unknown; despues: unknown }>
  cambiosTarifas: CambioTarifa[]
  metricas: MetricaPlaneada[]
  incidencias: Incidencia[]
}

export interface MetricaPlaneada {
  plataforma: string
  crudo: string
  seguidores: number | null
  confianza: EstadoParseoMetrica
  requiereRevision: boolean
  notas: string[]
}

export interface PlanImportacion {
  archivo: string
  sha256: string
  tipo: 'CRM_COMERCIAL' | 'ROSTER'
  hojasDetectadas: Array<{ hoja: string; deteccion: DeteccionEncabezado }>
  talentos: EntradaPlanTalento[]
  /** Talentos que existen en la base y el archivo no trae. NUNCA se borran. */
  ausentes: Array<{ talentId: string; displayName: string }>
  incidencias: Incidencia[]
  resumen: ResumenPlan
}

export interface ResumenPlan {
  talentosEnArchivo: number
  aCrear: number
  aActualizar: number
  sinCambios: number
  requierenRevision: number
  tarifasNuevas: number
  tarifasModificadas: number
  tarifasEnConflicto: number
  metricasNuevas: number
  incidenciasPorSeveridad: Record<Severidad, number>
}

// ─────────────────────────── Precios ───────────────────────────

export type EstadoPrecioImport =
  | 'QUOTED'
  | 'PENDING'
  | 'NOT_APPLICABLE'
  | 'CASE_BY_CASE'

export type AvisoPrecio =
  | 'TOKEN_NO_RECONOCIDO'
  | 'NEGATIVO'
  | 'MAGNITUD_SOSPECHOSA'
  | 'CELDA_VACIA'

export interface PrecioParseado {
  amountCents: number | null
  /** `null` ⇒ no se pudo interpretar: exige decisión humana. */
  status: EstadoPrecioImport | null
  crudo: string
  ok: boolean
  aviso?: { codigo: AvisoPrecio; mensaje: string }
}

// ─────────────────────────── Métricas ───────────────────────────

export type EstadoParseoMetrica = 'EXACTO' | 'INFERIDO' | 'FALLIDO'

export interface MetricaParseada {
  seguidores: number | null
  crudo: string
  confianza: EstadoParseoMetrica
  requiereRevision: boolean
  notas: string[]
}

// ─────────────────────────── Identidad ───────────────────────────

export interface CandidatoIdentidad {
  talentId: string
  codigo: string | null
  canonicalName: string
  displayName: string
  coincidioPor: 'exacto' | 'levenshtein' | 'tokens' | 'jaro'
  puntaje: number
}

export interface ResolucionIdentidad {
  crudo: string
  normalizado: string
  variantes: string[]
  decision: 'COINCIDENCIA_EXACTA' | 'REQUIERE_REVISION' | 'CREAR_NUEVO'
  mejor?: CandidatoIdentidad
  alternativas: CandidatoIdentidad[]
  /** Explicación en español para la UI. */
  motivo: string
}
