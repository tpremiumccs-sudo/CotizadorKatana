import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { leerSesion } from '@/server/auth/session'
import { FormularioCambio } from './formulario'

export const metadata: Metadata = { title: 'Cambiar contraseña' }

export default async function PaginaCambio() {
  const s = await leerSesion()
  if (!s) redirect('/acceso')

  return (
    <main className="min-h-dvh bg-white">
      <div className="h-[17px] w-full bg-katana-500" aria-hidden />
      <div className="mx-auto w-full max-w-md px-6 py-12 sm:py-20">
        <h1 className="text-2xl font-bold tracking-tight text-katana-800">
          {s.debeCambiarPassword ? 'Cambia tu contraseña' : 'Cambiar contraseña'}
        </h1>
        <p className="mt-2 text-sm text-tinta-suave">
          {s.debeCambiarPassword
            ? 'Tu contraseña inicial la definió un administrador. Elige una que solo tú conozcas para continuar.'
            : 'Al cambiarla se cerrarán tus demás sesiones.'}
        </p>
        <div className="mt-8">
          <FormularioCambio email={s.actor.email} />
        </div>
      </div>
    </main>
  )
}
