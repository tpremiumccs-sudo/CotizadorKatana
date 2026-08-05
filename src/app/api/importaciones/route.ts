import { NextResponse } from 'next/server'
import {
  subirYPlanear, MAX_BYTES, ArchivoInvalidoError,
} from '@/server/data/importacion'
import { ForbiddenError } from '@/lib/authz/policy'

/**
 * Subida del .xlsx.
 *
 * Va por Route Handler y no por Server Action a propósito: las acciones tienen
 * un límite de 1 MB en el cuerpo, y el CRM KATANA ENGINE con sus 17 hojas lo
 * pasa de sobra. Con una acción la importación se rompería justo con el archivo
 * de verdad y funcionaría con cualquier ejemplo pequeño.
 */

export const runtime = 'nodejs'
// Leer 17 hojas y planear ~400 celdas lleva más que el límite por omisión.
export const maxDuration = 120

export async function POST(req: Request) {
  let datos: FormData
  try {
    datos = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'No se pudo leer el archivo enviado.' },
      { status: 400 },
    )
  }

  const archivo = datos.get('archivo')
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 })
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          `El archivo pesa ${(archivo.size / 1_048_576).toFixed(1)} MB y el límite ` +
          `es ${MAX_BYTES / 1_048_576} MB.`,
      },
      { status: 413 },
    )
  }

  try {
    const contenido = Buffer.from(await archivo.arrayBuffer())
    const { importBatchId, plan } = await subirYPlanear(archivo.name, contenido)
    return NextResponse.json(
      { importBatchId, resumen: plan.resumen },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    )
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 })
    }
    if (e instanceof ArchivoInvalidoError) {
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `No se pudo leer el archivo: ${e.message}`
            : 'No se pudo leer el archivo.',
      },
      { status: 500 },
    )
  }
}
