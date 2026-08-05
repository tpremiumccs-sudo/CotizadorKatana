'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import {
  verifyPassword, hashPassword, necesitaRehash, validarPassword,
} from '@/server/auth/password'
import {
  crearSesion, contextoPeticion, cerrarSesion, revocarSesionesDe, leerSesion,
} from '@/server/auth/session'
import { verificarLimite, registrarIntento } from '@/server/auth/rate-limit'
import {
  credencialPorEmail, credencialPorId, actualizarHash, establecerPassword,
  registrarEvento, comoActor,
} from '@/server/data/usuario'

const esquemaAcceso = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Escribe un correo válido.')),
  password: z.string().min(1, 'Escribe tu contraseña.'),
  recordar: z.union([z.literal('on'), z.null(), z.undefined()]).optional(),
})

export interface EstadoAcceso {
  error?: string
  campo?: 'email' | 'password'
}

/**
 * Inicio de sesión.
 *
 * El mensaje de error es el MISMO tanto si el correo no existe como si la
 * contraseña es incorrecta. Distinguirlos convertiría el formulario en un
 * comprobador de qué correos tienen cuenta en la agencia.
 */
export async function iniciarSesion(
  _previo: EstadoAcceso,
  datos: FormData,
): Promise<EstadoAcceso> {
  const parseo = esquemaAcceso.safeParse({
    email: datos.get('email'),
    password: datos.get('password'),
    recordar: datos.get('recordar'),
  })
  if (!parseo.success) {
    const primero = parseo.error.issues[0]
    return {
      error: primero?.message ?? 'Revisa los datos.',
      campo: primero?.path[0] === 'email' ? 'email' : 'password',
    }
  }

  const { email, password, recordar } = parseo.data
  const ctx = await contextoPeticion()

  const limite = await verificarLimite(email, ctx.ip)
  if (!limite.permitido) return { error: limite.motivo }

  const credencial = await credencialPorEmail(email)
  const hashValido = credencial?.passwordHash ?? null

  // Se verifica SIEMPRE, incluso sin usuario, contra un hash de relleno: así el
  // tiempo de respuesta no delata si el correo existe.
  const HASH_RELLENO =
    '$argon2id$v=19$m=65536,t=3,p=1$c2FsYWRlcmVsbGVubw$ZmFrZWhhc2hmb3J0aW1pbmc'
  const correcta = await verifyPassword(hashValido ?? HASH_RELLENO, password)

  const MENSAJE_GENERICO = 'Correo o contraseña incorrectos.'

  if (!credencial || !hashValido || !correcta) {
    await registrarIntento(
      email, ctx.ip, false,
      !credencial ? 'usuario inexistente' : 'contraseña incorrecta',
    )
    return { error: MENSAJE_GENERICO }
  }

  const usuario = credencial.usuario
  if (usuario.estado !== 'ACTIVO') {
    await registrarIntento(email, ctx.ip, false, `cuenta ${usuario.estado}`)
    return {
      error:
        usuario.estado === 'SUSPENDIDO'
          ? 'Tu cuenta está suspendida. Pide a un administrador que la reactive.'
          : 'Tu cuenta está desactivada.',
    }
  }

  await registrarIntento(email, ctx.ip, true)

  // Si los parámetros de argon2 subieron desde que se guardó, se re-hashea
  // aprovechando que aquí sí tenemos la contraseña en claro.
  if (necesitaRehash(hashValido)) {
    await actualizarHash(usuario.id, await hashPassword(password))
  }

  const sesionId = await crearSesion(usuario.id, {
    recordar: recordar === 'on',
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  })

  await registrarEvento({
    actor: comoActor(usuario),
    categoria: 'AUTENTICACION',
    accion: 'sesion.iniciada',
    resumen: `${usuario.nombre} inició sesión.`,
    ip: ctx.ip, userAgent: ctx.userAgent, sesionId,
  })

  redirect(usuario.debeCambiarPassword ? '/cambiar-contrasena' : '/')
}

export async function cerrarSesionAccion(): Promise<void> {
  const s = await leerSesion()
  if (s) {
    const ctx = await contextoPeticion()
    await registrarEvento({
      actor: s.actor,
      categoria: 'AUTENTICACION',
      accion: 'sesion.cerrada',
      resumen: `${s.actor.nombre} cerró sesión.`,
      ip: ctx.ip, sesionId: s.sesionId,
    })
  }
  await cerrarSesion()
  redirect('/acceso')
}

const esquemaCambio = z
  .object({
    actual: z.string().min(1, 'Escribe tu contraseña actual.'),
    nueva: z.string(),
    confirmacion: z.string(),
  })
  .refine((d) => d.nueva === d.confirmacion, {
    message: 'Las dos contraseñas nuevas no coinciden.',
    path: ['confirmacion'],
  })

export async function cambiarPassword(
  _previo: EstadoAcceso,
  datos: FormData,
): Promise<EstadoAcceso> {
  const s = await leerSesion()
  if (!s) redirect('/acceso')

  const parseo = esquemaCambio.safeParse({
    actual: datos.get('actual'),
    nueva: datos.get('nueva'),
    confirmacion: datos.get('confirmacion'),
  })
  if (!parseo.success) {
    return { error: parseo.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const credencial = await credencialPorId(s.actor.id)
  if (!credencial?.passwordHash) redirect('/acceso')

  if (!(await verifyPassword(credencial.passwordHash, parseo.data.actual))) {
    return { error: 'Tu contraseña actual no es correcta.', campo: 'password' }
  }

  const validacion = validarPassword(parseo.data.nueva, {
    email: s.actor.email, nombre: s.actor.nombre,
  })
  if (!validacion.ok) return { error: validacion.motivo }

  await establecerPassword(s.actor.id, await hashPassword(parseo.data.nueva))

  const ctx = await contextoPeticion()
  await registrarEvento({
    actor: s.actor,
    categoria: 'AUTENTICACION',
    accion: 'password.cambiada',
    resumen: `${s.actor.nombre} cambió su contraseña.`,
    ip: ctx.ip, sesionId: s.sesionId,
  })

  // Cambiar la contraseña cierra las demás sesiones: si alguien tenía acceso,
  // deja de tenerlo en el acto.
  await revocarSesionesDe(s.actor.id, 'cambio de contraseña')
  await crearSesion(s.actor.id, { ip: ctx.ip, userAgent: ctx.userAgent })

  redirect('/')
}
