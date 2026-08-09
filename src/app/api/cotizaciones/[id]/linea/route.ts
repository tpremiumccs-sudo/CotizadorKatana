import { NextResponse } from 'next/server'
import { z } from 'zod'
import { agregarRenglon, actualizarRenglon, quitarRenglon } from '@/server/data/hoja'
import { leerRevision, leerCuerpo, responder } from '@/server/http/revision'
import { TECHO_CENTAVOS } from '@/lib/money'

/**
 * Renglones de la cotización: agregar, ajustar y quitar.
 *
 * Mismo protocolo que el guardado de precios del tabulador —`If-Match`, 409 al
 * conflicto, 428 si falta la cabecera— porque el editor ya sabe hablarlo y
 * porque un segundo protocolo para lo mismo es un segundo sitio donde
 * equivocarse.
 */

const nuevo = z.object({
  quoteTalentId: z.string().min(1),
  deliverableTypeId: z.string().min(1),
})

const cambio = z
  .object({
    lineaId: z.string().min(1),
    cantidad: z.number().int().min(1).max(9999).optional(),
    unitAmountCents: z.number().int().min(0).max(TECHO_CENTAVOS).nullable().optional(),
    priceStatus: z
      .enum(['QUOTED', 'PENDING', 'NOT_APPLICABLE', 'CASE_BY_CASE'])
      .optional(),
  })
  .refine(
    (d) => d.priceStatus !== 'QUOTED' || d.unitAmountCents !== null,
    { message: 'Un precio cotizado necesita un importe.', path: ['unitAmountCents'] },
  )

const borrado = z.object({ lineaId: z.string().min(1) })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const revision = leerRevision(req)
  if (revision instanceof NextResponse) return revision

  const datos = await leerCuerpo(req, nuevo)
  if (datos instanceof NextResponse) return datos

  return responder(() =>
    agregarRenglon({
      quoteId: id,
      quoteTalentId: datos.quoteTalentId,
      deliverableTypeId: datos.deliverableTypeId,
      revision,
    }),
  )
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const revision = leerRevision(req)
  if (revision instanceof NextResponse) return revision

  const datos = await leerCuerpo(req, cambio)
  if (datos instanceof NextResponse) return datos

  return responder(() =>
    actualizarRenglon({
      quoteId: id,
      lineaId: datos.lineaId,
      revision,
      cantidad: datos.cantidad,
      unitAmountCents: datos.unitAmountCents,
      priceStatus: datos.priceStatus,
    }),
  )
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const revision = leerRevision(req)
  if (revision instanceof NextResponse) return revision

  const datos = await leerCuerpo(req, borrado)
  if (datos instanceof NextResponse) return datos

  return responder(() => quitarRenglon(id, datos.lineaId, revision))
}
