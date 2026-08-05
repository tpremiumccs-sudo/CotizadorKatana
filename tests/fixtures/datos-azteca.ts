import type { DocumentoCotizacion } from '@/lib/doc/tipos'
import { computeQuote } from '@/server/pricing/compute'
import { importeALetra } from '@/lib/doc/numero-a-letra'
import { formatMXN } from '@/lib/money'
import { documentoHonor } from './datos-honor'

/**
 * La cotización real de Azteca Peleas, folio KAT-AZT-2026-001.
 *
 * Del registro del CRM: "Opciones independientes por talento: 1 Reel
 * colaborativo + 4 Stories", con Luis Pride en $340,000, Tejón de la Miel en
 * $340,000, Chuy Almada en $400,000 y Ronny en $310,000, todos más IVA.
 *
 * Las tarifas de Luis Pride, Tejón y Ronny salen tal cual del tarifario. Las de
 * Chuy Almada NO: su tarifario da $240,000 y se cotizó en $400,000. Se
 * reproduce con precios ajustados, que es como trabaja la agencia.
 */

const P = (pesos: number) => pesos * 100

interface Talento {
  id: string
  nombre: string
  reelCollab: number
  story: number
}

const TALENTOS: Talento[] = [
  { id: 'lp', nombre: 'Luis Pride', reelCollab: P(180_000), story: P(40_000) },
  { id: 'tj', nombre: 'Tejón de la Miel', reelCollab: P(180_000), story: P(40_000) },
  // Ajustado: el tarifario da $140,000 y $25,000.
  { id: 'ca', nombre: 'Chuy Almada', reelCollab: P(240_000), story: P(40_000) },
  { id: 'ro', nombre: 'Ronny', reelCollab: P(150_000), story: P(40_000) },
]

export function documentoAzteca(logoDataUri: string): DocumentoCotizacion {
  const calculo = computeQuote({
    talents: TALENTOS.map((t) => ({ id: t.id, displayName: t.nombre })),
    lines: TALENTOS.flatMap((t) => [
      {
        id: `${t.id}-reel`, quoteTalentId: t.id, quantity: 1,
        unitAmountCents: t.reelCollab, priceStatus: 'QUOTED' as const,
      },
      {
        id: `${t.id}-story`, quoteTalentId: t.id, quantity: 4,
        unitAmountCents: t.story, priceStatus: 'QUOTED' as const,
      },
    ]),
    taxMode: 'ADDED',
    taxRateBps: 1600,
  })

  const base = documentoHonor(logoDataUri)

  return {
    tipo: 'COTIZACION',
    eyebrow: base.eyebrow,
    titulo: 'Cotización',
    cliente: 'TV Azteca',
    folio: 'KAT-AZT-2026-001',
    meta: [
      { etiqueta: 'CLIENTE', valor: 'TV Azteca' },
      { etiqueta: 'CONTACTO', valor: 'Jorge Garduño' },
      { etiqueta: 'AGENTE', valor: 'Chuy Gallardo' },
      { etiqueta: 'MONEDA', valor: 'MXN + IVA' },
    ],
    alcance: 'Azteca Peleas — promoción digital — 03-oct-2026',
    bloques: TALENTOS.map((t) => {
      const talento = calculo.talents.find((x) => x.id === t.id)!
      const reel = calculo.lines.find((l) => l.id === `${t.id}-reel`)!
      const story = calculo.lines.find((l) => l.id === `${t.id}-story`)!
      return {
        nombre: t.nombre,
        renglones: [
          {
            concepto: 'Reel colaborativo (Instagram)',
            cantidad: 1,
            unitAmountCents: t.reelCollab,
            status: 'QUOTED' as const,
            totalCents: reel.totalCents,
            informativa: false,
          },
          {
            concepto: 'Story (Instagram)',
            cantidad: 4,
            unitAmountCents: t.story,
            status: 'QUOTED' as const,
            totalCents: story.totalCents,
            informativa: false,
          },
          {
            concepto: 'Presencia en evento',
            detalle: 'Sujeta a disponibilidad',
            cantidad: 1,
            unitAmountCents: null,
            status: 'CASE_BY_CASE' as const,
            totalCents: 0,
            informativa: true,
          },
        ],
        netCents: talento.netCents,
      }
    }),
    totales: {
      subtotalCents: calculo.subtotalCents,
      descuentoCents: calculo.packageDiscountCents,
      baseGravableCents: calculo.taxableBaseCents,
      ivaCents: calculo.taxCents,
      ivaEtiqueta: 'IVA 16%',
      totalCents: calculo.totalCents,
      totalEnLetra: importeALetra(calculo.totalCents),
    },
    tituloConsideraciones: base.tituloConsideraciones,
    consideraciones: [
      'Tarifas expresadas en pesos mexicanos (MXN).',
      'Los importes ya incluyen el IVA desglosado al final.',
      'No incluyen producción.',
      'No incluyen viáticos.',
      'No incluyen derechos de uso de imagen.',
      'No incluyen pauta digital (whitelisting).',
      'No incluyen exclusividad.',
      'Sujetas a disponibilidad del talento.',
      'Sujetas a confirmación y aprobación final por Katana Talent.',
    ],
    tituloTerminos: base.tituloTerminos,
    terminos: base.terminos,
    confidencialidadTitulo: base.confidencialidadTitulo,
    confidencialidadTexto: base.confidencialidadTexto,
    firma: base.firma,
    piePagina: base.piePagina,
    logoDataUri,
    textoPendiente: 'Cotizar',
    textoCasoPorCaso: 'Cotización aparte',
    textoNoAplica: 'No aplica',
    textoVacio: '—',
    preciosEnMorado: false,
  }
}

/** Los importes que el CRM registra, para comprobarlos en la prueba. */
export const IMPORTES_AZTECA = {
  porTalento: {
    'Luis Pride': P(340_000),
    'Tejón de la Miel': P(340_000),
    'Chuy Almada': P(400_000),
    Ronny: P(310_000),
  },
  subtotal: P(1_390_000),
  iva: P(222_400),
  total: P(1_612_400),
  totalFormateado: formatMXN(P(1_612_400)),
}
