import { NextResponse } from 'next/server'
import { z } from 'zod'
import { actualizarEncabezado } from '@/server/data/hoja'
import { leerRevision, leerCuerpo, responder } from '@/server/http/revision'

/** Cliente y proyecto. En la hoja son encabezado editable, no un formulario. */

const cambio = z.object({
  cliente: z.string().min(1, 'Escribe el nombre del cliente.').max(200).optional(),
  proyecto: z.string().max(200).nullable().optional(),
})

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
    actualizarEncabezado({
      quoteId: id,
      revision,
      cliente: datos.cliente,
      proyecto: datos.proyecto,
    }),
  )
}
