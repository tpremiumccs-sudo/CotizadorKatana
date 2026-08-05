'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  crearUsuario, actualizarUsuario, reiniciarPassword,
} from '@/server/data/admin'
import { ForbiddenError } from '@/lib/authz/policy'

export interface EstadoAdmin {
  error?: string
  aviso?: string
}

const ROL = z.enum(['ADMIN', 'COMERCIAL', 'LECTURA'])

const esquemaAlta = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Escribe un correo válido.')),
  nombre: z.string().trim().min(2, 'Escribe el nombre completo.'),
  rol: ROL,
  esAprobador: z.boolean(),
  password: z.string().min(1, 'Pon una contraseña inicial.'),
})

function mensaje(e: unknown): string {
  if (e instanceof ForbiddenError) return e.message
  return e instanceof Error ? e.message : 'No se pudo completar la operación.'
}

export async function crearUsuarioAccion(
  _previo: EstadoAdmin,
  datos: FormData,
): Promise<EstadoAdmin> {
  const parseo = esquemaAlta.safeParse({
    email: datos.get('email'),
    nombre: datos.get('nombre'),
    rol: datos.get('rol'),
    esAprobador: datos.get('esAprobador') === 'on',
    password: datos.get('password'),
  })
  if (!parseo.success) {
    return { error: parseo.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  try {
    const u = await crearUsuario({
      email: parseo.data.email,
      nombre: parseo.data.nombre,
      rol: parseo.data.rol,
      esAprobador: parseo.data.esAprobador,
      passwordInicial: parseo.data.password,
    })
    revalidatePath('/admin/usuarios')
    return {
      aviso:
        `${u.nombre} ya puede entrar con ${u.email}. ` +
        'Tendrá que elegir su propia contraseña en el primer acceso: ' +
        'dile la inicial en persona, no por escrito.',
    }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

const esquemaCambio = z.object({
  usuarioId: z.string().min(1),
  rol: ROL.optional(),
  estado: z.enum(['ACTIVO', 'SUSPENDIDO', 'DESACTIVADO']).optional(),
  esAprobador: z.boolean().optional(),
})

export async function actualizarUsuarioAccion(
  _previo: EstadoAdmin,
  datos: FormData,
): Promise<EstadoAdmin> {
  const crudo: Record<string, unknown> = { usuarioId: datos.get('usuarioId') }
  if (datos.get('rol')) crudo.rol = datos.get('rol')
  if (datos.get('estado')) crudo.estado = datos.get('estado')
  if (datos.has('esAprobador')) crudo.esAprobador = datos.get('esAprobador') === 'on'

  const parseo = esquemaCambio.safeParse(crudo)
  if (!parseo.success) return { error: 'Revisa los datos.' }

  try {
    const { revocadas } = await actualizarUsuario(parseo.data)
    revalidatePath('/admin/usuarios')
    return {
      aviso:
        revocadas > 0
          ? `Listo. Se cerraron ${revocadas} sesión(es) abierta(s): el cambio surte efecto ya, no cuando recargue.`
          : 'Listo.',
    }
  } catch (e) {
    return { error: mensaje(e) }
  }
}

export async function reiniciarPasswordAccion(
  _previo: EstadoAdmin,
  datos: FormData,
): Promise<EstadoAdmin> {
  const usuarioId = String(datos.get('usuarioId') ?? '')
  const password = String(datos.get('password') ?? '')
  if (!usuarioId || !password) return { error: 'Falta la contraseña nueva.' }

  try {
    const { revocadas } = await reiniciarPassword(usuarioId, password)
    revalidatePath('/admin/usuarios')
    return {
      aviso:
        `Contraseña reiniciada y ${revocadas} sesión(es) cerrada(s). ` +
        'Tendrá que elegir una nueva al entrar.',
    }
  } catch (e) {
    return { error: mensaje(e) }
  }
}
