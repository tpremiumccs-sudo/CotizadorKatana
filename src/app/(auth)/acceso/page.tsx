import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { leerSesion } from '@/server/auth/session'
import { FormularioAcceso } from './formulario'

export const metadata: Metadata = { title: 'Acceso' }

export default async function PaginaAcceso() {
  // Con sesión abierta no tiene sentido volver a pedir credenciales.
  const s = await leerSesion()
  if (s) redirect('/')

  return (
    <main className="min-h-dvh bg-white">
      <div className="h-[17px] w-full bg-katana-500" aria-hidden />

      <div className="mx-auto flex w-full max-w-md flex-col justify-center px-6 py-12 sm:py-20">
        <header className="mb-8">
          <p className="text-xs font-bold tracking-[0.14em] text-katana-500">
            KATANA TALENT
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-katana-800">
            Cotizador
          </h1>
          <p className="mt-2 text-sm text-tinta-suave">
            Entra con tu cuenta para armar y consultar cotizaciones.
          </p>
        </header>

        <FormularioAcceso />

        <p className="mt-8 text-xs leading-relaxed text-etiqueta">
          Información confidencial de Katana Talent. Si no tienes cuenta, pídesela
          a un administrador.
        </p>
      </div>
    </main>
  )
}
