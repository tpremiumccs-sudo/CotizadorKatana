import 'server-only'
import { redirect } from 'next/navigation'
import { leerSesion } from '@/server/auth/session'
import type { Actor } from '@/lib/authz/policy'

/**
 * Obtiene el actor de la petición.
 *
 * Es la ÚNICA puerta de entrada a la identidad. Todo lo que escribe pasa por
 * aquí, así que no hay forma de que una acción se ejecute sin saber quién la
 * pidió — y por tanto sin poder registrarla en la bitácora.
 */
export async function actorActual(): Promise<Actor | null> {
  const s = await leerSesion()
  return s?.actor ?? null
}

/** Exige sesión. Redirige al acceso si no la hay. */
export async function requireActor(): Promise<Actor> {
  const s = await leerSesion()
  if (!s) redirect('/acceso')
  // Con contraseña inicial pendiente de cambiar, no se deja entrar a nada más.
  if (s.debeCambiarPassword) redirect('/cambiar-contrasena')
  return s.actor
}
