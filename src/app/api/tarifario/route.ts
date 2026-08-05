import { NextResponse } from 'next/server'
import { z } from 'zod'
import { guardarTarifa, ConflictoTarifaError } from '@/server/data/tarifario'
import { ForbiddenError } from '@/lib/authz/policy'
import { TECHO_CENTAVOS } from '@/lib/money'

const cuerpo = z
  .object({
    talentId: z.string().min(1),
    deliverableTypeId: z.string().min(1),
    priceStatus: z.enum(['QUOTED', 'PENDING', 'NOT_APPLICABLE', 'CASE_BY_CASE']),
    amountCents: z.number().int().min(0).max(TECHO_CENTAVOS).nullable(),
    revision: z.number().int().min(0).nullable(),
  })
  .refine((d) => d.priceStatus !== 'QUOTED' || d.amountCents !== null, {
    message: 'Un precio con tarifa necesita un importe.',
    path: ['amountCents'],
  })

export async function PATCH(req: Request) {
  let datos: z.infer<typeof cuerpo>
  try {
    datos = cuerpo.parse(await req.json())
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? (e.issues[0]?.message ?? 'Datos inválidos.')
            : 'No se pudo leer la petición.',
      },
      { status: 400 },
    )
  }

  try {
    const celda = await guardarTarifa(datos)
    return NextResponse.json({ celda }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    if (e instanceof ConflictoTarifaError) {
      return NextResponse.json({ error: e.message }, { status: 409 })
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
