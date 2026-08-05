/**
 * Política de contraseñas.
 *
 * Función PURA, sin `server-only` y sin dependencias: la aplican el servidor al
 * cambiar una contraseña y el seed al crear el primer administrador. Vivía
 * dentro de `src/server/auth/password.ts`, que sí es de servidor, y por eso el
 * seed no podía aplicarla — con el resultado de que la única cuenta ADMIN nacía
 * violando la política del propio sistema.
 *
 * Longitud sobre complejidad: una frase larga resiste más que "P@ssw0rd!". Se
 * bloquean también las que contienen el nombre del sistema, que es lo primero
 * que prueba cualquiera.
 */

export const LONGITUD_MINIMA = 12
export const LONGITUD_MAXIMA = 200

/** Lo primero que prueba quien quiere entrar. */
export const PALABRAS_PROHIBIDAS = [
  'katana',
  'cotizador',
  'password',
  'contrasena',
  '123456',
  'qwerty',
] as const

export type ResultadoPolitica = { ok: true } | { ok: false; motivo: string }

export function validarPassword(
  plano: string,
  contexto: { email?: string; nombre?: string } = {},
): ResultadoPolitica {
  if (plano.length < LONGITUD_MINIMA) {
    return {
      ok: false,
      motivo: `La contraseña debe tener al menos ${LONGITUD_MINIMA} caracteres.`,
    }
  }
  if (plano.length > LONGITUD_MAXIMA) {
    return {
      ok: false,
      motivo: `La contraseña es demasiado larga (máximo ${LONGITUD_MAXIMA}).`,
    }
  }

  const n = plano.toLowerCase()
  for (const p of PALABRAS_PROHIBIDAS) {
    if (n.includes(p)) {
      return {
        ok: false,
        motivo: `La contraseña no puede contener "${p}". Usa una frase que solo tú conozcas.`,
      }
    }
  }

  const local = contexto.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && n.includes(local)) {
    return { ok: false, motivo: 'La contraseña no puede contener tu correo.' }
  }
  if (contexto.nombre) {
    for (const parte of contexto.nombre.toLowerCase().split(/\s+/)) {
      if (parte.length >= 4 && n.includes(parte)) {
        return { ok: false, motivo: 'La contraseña no puede contener tu nombre.' }
      }
    }
  }

  return { ok: true }
}
