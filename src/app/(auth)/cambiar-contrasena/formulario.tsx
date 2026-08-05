'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { cambiarPassword, type EstadoAcceso } from '../acceso/acciones'

const CAMPO =
  'min-h-[44px] w-full rounded-katana border border-katana-200 bg-white px-3 text-base ' +
  'text-tinta focus:border-katana-500 focus:outline-none'

function Boton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      data-touch-target
      className="min-h-[44px] w-full rounded-katana bg-katana-500 px-4 text-sm font-semibold
                 text-white hover:bg-katana-600 disabled:opacity-60"
    >
      {pending ? 'Guardando…' : 'Guardar contraseña'}
    </button>
  )
}

export function FormularioCambio({ email }: { email: string }) {
  const [estado, accion] = useActionState<EstadoAcceso, FormData>(cambiarPassword, {})

  return (
    <form action={accion} className="space-y-4" noValidate>
      {estado.error && (
        <div
          role="alert"
          data-testid="error-cambio"
          className="rounded-katana border border-red-200 bg-red-50 px-3 py-2 text-sm text-error"
        >
          {estado.error}
        </div>
      )}
      {/*
        Campo de usuario oculto: sin él los gestores de contraseñas no saben a
        qué cuenta pertenece la nueva contraseña y guardan una entrada suelta.
      */}
      <input
        type="text"
        name="usuario"
        value={email}
        autoComplete="username"
        readOnly
        hidden
        aria-hidden
        tabIndex={-1}
      />
      <div>
        <label htmlFor="actual" className="mb-1 block text-sm font-medium text-tinta">
          Contraseña actual
        </label>
        <input id="actual" name="actual" type="password" autoComplete="current-password" required className={CAMPO} />
      </div>
      <div>
        <label htmlFor="nueva" className="mb-1 block text-sm font-medium text-tinta">
          Contraseña nueva
        </label>
        <input id="nueva" name="nueva" type="password" autoComplete="new-password" required className={CAMPO} />
        <p className="mt-1 text-xs text-etiqueta">
          Mínimo 12 caracteres. Una frase larga es mejor que símbolos raros.
        </p>
      </div>
      <div>
        <label htmlFor="confirmacion" className="mb-1 block text-sm font-medium text-tinta">
          Repite la contraseña nueva
        </label>
        <input id="confirmacion" name="confirmacion" type="password" autoComplete="new-password" required className={CAMPO} />
      </div>
      <Boton />
    </form>
  )
}
