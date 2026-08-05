import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardarPrecio, ConflictoRevisionError } from '@/server/data/cotizacion'
import { ForbiddenError } from '@/lib/authz/policy'
import { TECHO_CENTAVOS } from '@/lib/money'

/**
 * Guardado de una celda de precio.
 *
 * Va por Route Handler y no por Server Action porque necesita responder con un
 * código de estado real: `409 Conflict` cuando otra pestaña guardó primero. Una
 * acción de servidor devolvería un objeto y el cliente tendría que inventarse
 * un protocolo encima; aquí ya existe uno.
 *
 * El bloqueo optimista viaja en `If-Match`, que es exactamente para lo que está
 * esa cabecera: "aplica esto sólo si la versión sigue siendo la que vi".
 */

const cuerpo = z
  .object({
    quotePriceId: z.string().min(1),
    // `null` en ambos = quitar el ajuste y volver al tarifario.
    status: z
      .enum(['QUOTED', 'PENDING', 'NOT_APPLICABLE', 'CASE_BY_CASE'])
      .nullable(),
    amountCents: z.number().int().min(0).max(TECHO_CENTAVOS).nullable(),
    motivo: z.string().max(500).optional(),
  })
  .refine((d) => d.status !== 'QUOTED' || d.amountCents !== null, {
    message: 'Un precio cotizado necesita un importe.',
    path: ['amountCents'],
  })

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const ifMatch = req.headers.get('if-match')
  const revision = Number(ifMatch)
  if (!ifMatch || !Number.isInteger(revision) || revision < 0) {
    return NextResponse.json(
      { error: 'Falta la cabecera If-Match con la revisión.' },
      { status: 428 }, // Precondition Required
    )
  }

  let datos: z.infer<typeof cuerpo>
  try {
    datos = cuerpo.parse(await req.json())
  } catch (e) {
    const mensaje =
      e instanceof z.ZodError
        ? (e.issues[0]?.message ?? 'Datos inválidos.')
        : 'No se pudo leer la petición.'
    return NextResponse.json({ error: mensaje }, { status: 400 })
  }

  try {
    const r = await guardarPrecio({
      quoteId: id,
      quotePriceId: datos.quotePriceId,
      revision,
      amountCents: datos.amountCents,
      status: datos.status,
      motivo: datos.motivo,
    })
    return NextResponse.json(r, {
      status: 200,
      headers: { etag: String(r.revision), 'cache-control': 'no-store' },
    })
  } catch (e) {
    if (e instanceof ConflictoRevisionError) {
      return NextResponse.json(
        {
          error: e.message,
          revisionActual: e.revisionActual,
          quien: e.quienNombre,
        },
        { status: 409, headers: { etag: String(e.revisionActual) } },
      )
    }
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo guardar.' },
      { status: 400 },
    )
  }
}
