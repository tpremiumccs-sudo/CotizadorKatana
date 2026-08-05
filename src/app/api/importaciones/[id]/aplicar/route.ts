import { NextResponse } from 'next/server'
import { z } from 'zod'
import { aplicarImportacion } from '@/server/data/importacion'
import { ForbiddenError } from '@/lib/authz/policy'

export const runtime = 'nodejs'
// Escribir ~400 tarifas con sus revisiones en una transacción lleva su tiempo.
export const maxDuration = 180

const cuerpo = z.object({
  conflictos: z
    .record(z.string(), z.enum(['CONSERVAR_APP', 'TOMAR_ARCHIVO']))
    .optional(),
  asignaciones: z.record(z.string(), z.string()).optional(),
  crearNuevos: z.array(z.string()).optional(),
  ignorar: z.array(z.string()).optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let decisiones: z.infer<typeof cuerpo>
  try {
    decisiones = cuerpo.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Decisiones inválidas.' }, { status: 400 })
  }

  try {
    const r = await aplicarImportacion(id, decisiones)
    return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 })
    }
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `No se aplicó nada: ${e.message}`
            : 'No se aplicó nada.',
      },
      { status: 400 },
    )
  }
}
