'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { crearCotizacion } from '@/server/data/cotizacion'
import { crearBorradorVacio } from '@/server/data/hoja'
import { ForbiddenError } from '@/lib/authz/policy'

/**
 * Abre una cotización nueva y entra directo a ella.
 *
 * Sin formulario previo: no se pregunta cliente, ni talentos, ni formatos. El
 * borrador nace vacío y se llena en la hoja, que es donde el usuario ya está
 * mirando. Esto es lo que convierte cinco interacciones en una.
 */
export async function abrirHojaNueva(): Promise<void> {
  let id: string
  try {
    id = await crearBorradorVacio()
  } catch (e) {
    if (e instanceof ForbiddenError) redirect('/cotizaciones')
    throw e
  }
  redirect(`/cotizaciones/${id}`)
}

const esquema = z.object({
  clienteNombre: z.string().trim().min(1, 'Escribe el nombre del cliente.'),
  contactoNombre: z.string().trim().optional(),
  proyecto: z.string().trim().optional(),
  talentIds: z.array(z.string().min(1)).min(1, 'Elige al menos un talento.'),
  formatoIds: z.array(z.string().min(1)).min(1, 'Elige al menos un formato.'),
})

export interface EstadoNueva {
  error?: string
}

export async function crearCotizacionAccion(
  _previo: EstadoNueva,
  datos: FormData,
): Promise<EstadoNueva> {
  const parseo = esquema.safeParse({
    clienteNombre: datos.get('cliente'),
    contactoNombre: datos.get('contacto') || undefined,
    proyecto: datos.get('proyecto') || undefined,
    talentIds: datos.getAll('talento').map(String),
    formatoIds: datos.getAll('formato').map(String),
  })
  if (!parseo.success) {
    return { error: parseo.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  let id: string
  try {
    id = await crearCotizacion(parseo.data)
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message }
    return { error: e instanceof Error ? e.message : 'No se pudo crear.' }
  }

  redirect(`/cotizaciones/${id}`)
}
