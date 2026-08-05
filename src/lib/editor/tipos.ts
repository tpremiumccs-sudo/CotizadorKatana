import type {
  DocumentoTabulador,
  CeldaPrecio,
  EstadoPrecioDoc,
} from '@/lib/doc/tipos'

/**
 * El estado del editor: lo mismo que ve el servidor y lo que maneja el
 * navegador.
 *
 * Viaja tal cual del servidor al cliente y de vuelta. Que sea un solo tipo es
 * lo que permite que la vista previa se dibuje en el navegador con la MISMA
 * función que imprime el PDF: si el editor tuviera su propia representación,
 * habría dos verdades y tarde o temprano dirían cosas distintas.
 */

/** Los cuatro estados que puede tener un precio. */
export type EstadoPrecioEditor = EstadoPrecioDoc

export type EstadoCotizacion =
  | 'DRAFT'
  | 'REQUIERE_APROBACION'
  | 'SENT'
  | 'IN_NEGOTIATION'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'

export interface CeldaEditor {
  /** Fila del QuotePrice; es a lo que apunta el guardado. */
  id: string
  quoteTalentId: string
  deliverableTypeId: string
  /** Lo que decía el tarifario cuando se armó la cotización. */
  baseAmountCents: number | null
  basePriceStatus: EstadoPrecioDoc
  /** El ajuste de esta cotización. `null` = no se ha ajustado. */
  overrideAmountCents: number | null
  overridePriceStatus: EstadoPrecioDoc | null
  overrideReason: string | null
}

export interface TalentoEditor {
  /** QuoteTalent.id */
  id: string
  talentId: string
  /** Lo que se imprime; puede acortarse sin tocar la ficha del talento. */
  nombre: string
  nombreCanonico: string
  orden: number
}

export interface ColumnaEditor {
  deliverableTypeId: string
  label: string
  sublabel: string | null
  orden: number
}

export interface EstadoEditor {
  quoteId: string
  /** Bloqueo optimista: se manda al guardar y el servidor lo compara. */
  revision: number
  folio: string | null
  draftRef: string
  estado: EstadoCotizacion
  titulo: string
  cliente: string
  contacto: string | null
  agente: string | null
  moneda: string
  talentos: TalentoEditor[]
  columnas: ColumnaEditor[]
  /** Clave `${quoteTalentId}|${deliverableTypeId}`. */
  celdas: Record<string, CeldaEditor>
  eyebrow: string
  tituloConsideraciones: string
  consideraciones: string[]
  tituloTerminos: string
  terminos: string[]
  confidencialidadTitulo: string
  confidencialidadTexto: string
  firma: string
  piePagina: string
  textoPendiente: string
  textoCasoPorCaso: string
  textoNoAplica: string
  textoVacio: string
  preciosEnMorado: boolean
  /** Centros de columna medidos del original; sólo para reproducir HONOR. */
  centrosColumna?: number[]
}

export function claveCelda(quoteTalentId: string, deliverableTypeId: string): string {
  return `${quoteTalentId}|${deliverableTypeId}`
}

/**
 * El precio que vale: el ajuste si lo hay, si no el del tarifario.
 *
 * Es la regla de negocio central. El tarifario es un punto de partida y cada
 * cotización se ajusta — el PDF de HONOR imprime $150,000 donde el tarifario
 * dice $195,000, y tres precios donde el tarifario dice "Pendiente".
 */
export function precioEfectivo(c: CeldaEditor): CeldaPrecio {
  const ajustado = tieneAjuste(c)
  if (c.overridePriceStatus !== null) {
    return {
      amountCents: c.overrideAmountCents,
      status: c.overridePriceStatus,
      ajustado,
    }
  }
  return {
    amountCents: c.baseAmountCents,
    status: c.basePriceStatus,
    ajustado: false,
  }
}

/**
 * ¿La celda está ajustada respecto al tarifario?
 *
 * Un "ajuste" que repite exactamente el precio base NO cuenta: marcarlo sería
 * ruido, y el porcentaje de diferencia que dispara la aprobación se calcula
 * sobre esto.
 */
export function tieneAjuste(c: CeldaEditor): boolean {
  if (c.overridePriceStatus === null) return false
  if (c.overridePriceStatus !== c.basePriceStatus) return true
  return c.overrideAmountCents !== c.baseAmountCents
}

/** Diferencia en centavos contra el base. `null` si no se puede comparar. */
export function deltaCentavos(c: CeldaEditor): number | null {
  if (!tieneAjuste(c)) return null
  if (c.overridePriceStatus !== 'QUOTED' || c.basePriceStatus !== 'QUOTED') return null
  if (c.overrideAmountCents === null || c.baseAmountCents === null) return null
  return c.overrideAmountCents - c.baseAmountCents
}

/** Diferencia en puntos base contra el base. `null` si el base no es un importe. */
export function deltaBps(c: CeldaEditor): number | null {
  const delta = deltaCentavos(c)
  if (delta === null || !c.baseAmountCents) return null
  return Math.round((delta / c.baseAmountCents) * 10_000)
}

/**
 * Construye el documento a partir del estado del editor.
 *
 * FUNCIÓN PURA. La ejecuta el navegador en cada tecleo para la vista previa y
 * el servidor para imprimir el PDF. Si divergieran, lo que Chuy enseña en la
 * junta y lo que recibe la marca no serían el mismo papel.
 */
export function documentoDesdeEditor(
  e: EstadoEditor,
  logoDataUri: string,
): DocumentoTabulador {
  const meta = [
    { etiqueta: 'CLIENTE', valor: e.cliente },
    { etiqueta: 'CONTACTO', valor: e.contacto ?? '—' },
    { etiqueta: 'AGENTE', valor: e.agente ?? '—' },
    { etiqueta: 'MONEDA', valor: e.moneda },
  ]

  const columnas = [...e.columnas].sort((a, b) => a.orden - b.orden)
  const talentos = [...e.talentos].sort((a, b) => a.orden - b.orden)

  return {
    tipo: 'TABULADOR',
    eyebrow: e.eyebrow,
    titulo: e.titulo,
    cliente: e.cliente,
    meta,
    columnas: columnas.map((c) => ({
      label: c.label,
      ...(c.sublabel ? { sublabel: c.sublabel } : {}),
    })),
    ...(e.centrosColumna ? { centrosColumna: e.centrosColumna } : {}),
    filas: talentos.map((t) => ({
      nombre: t.nombre,
      celdas: columnas.map((col) => {
        const c = e.celdas[claveCelda(t.id, col.deliverableTypeId)]
        // Sin fila de precio la celda va vacía; nunca cero, que se leería como
        // "gratis".
        return c
          ? precioEfectivo(c)
          : ({ amountCents: null, status: 'NOT_APPLICABLE' } as CeldaPrecio)
      }),
    })),
    tituloConsideraciones: e.tituloConsideraciones,
    consideraciones: e.consideraciones,
    tituloTerminos: e.tituloTerminos,
    terminos: e.terminos,
    confidencialidadTitulo: e.confidencialidadTitulo,
    confidencialidadTexto: e.confidencialidadTexto,
    firma: e.firma,
    piePagina: e.piePagina,
    logoDataUri,
    textoPendiente: e.textoPendiente,
    textoCasoPorCaso: e.textoCasoPorCaso,
    textoNoAplica: e.textoNoAplica,
    textoVacio: e.textoVacio,
    preciosEnMorado: e.preciosEnMorado,
  }
}
