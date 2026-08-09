import { NextResponse } from 'next/server'
import { z } from 'zod'
import { agregarTalento, quitarTalento } from '@/server/data/hoja'
import { leerRevision, leerCuerpo, responder } from '@/server/http/revision'

/** Talentos de la cotización: un tap los mete, otro los saca. */

const nuevo = z.object({ talentId: z.string().min(1) })
const borrado = z.object({ quoteTalentId: z.string().min(1) })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const revision = leerRevision(req)
  if (revision instanceof NextResponse) return revision

  const datos = await leerCuerpo(req, nuevo)
  if (datos instanceof NextResponse) return datos

  return responder(() => agregarTalento(id, datos.talentId, revision))
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

  return responder(() => quitarTalento(id, datos.quoteTalentId, revision))
}
