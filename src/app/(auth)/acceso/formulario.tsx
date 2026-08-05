'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { iniciarSesion, type EstadoAcceso } from './acciones'

function Boton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      data-touch-target
      className="min-h-[44px] w-full rounded-katana bg-katana-500 px-4 text-sm font-semibold
                 text-white transition-colors hover:bg-katana-600
                 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  )
}

const CAMPO =
  'min-h-[44px] w-full rounded-katana border border-katana-200 bg-white px-3 text-base ' +
  'text-tinta placeholder:text-etiqueta focus:border-katana-500 focus:outline-none'

export function FormularioAcceso() {
  const [estado, accion] = useActionState<EstadoAcceso, FormData>(iniciarSesion, {})

  return (
    <form action={accion} className="space-y-4" noValidate>
      {estado.error && (
        <div
          role="alert"
          data-testid="error-acceso"
          className="rounded-katana border border-red-200 bg-red-50 px-3 py-2 text-sm text-error"
        >
          {estado.error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-tinta">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          required
          aria-invalid={estado.campo === 'email' || undefined}
          className={CAMPO}
          placeholder="tu@katanatalent.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-tinta">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={estado.campo === 'password' || undefined}
          className={CAMPO}
        />
      </div>

      <label className="flex min-h-[44px] items-center gap-2 text-sm text-tinta-suave">
        <input
          name="recordar"
          type="checkbox"
          className="size-4 rounded border-katana-300 text-katana-500 focus:ring-katana-500"
        />
        Mantener la sesión abierta en este dispositivo
      </label>

      <Boton />
    </form>
  )
}
