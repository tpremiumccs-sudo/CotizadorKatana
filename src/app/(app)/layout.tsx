import { requireActor } from '@/server/data/actor'
import { BarraSesion } from './barra-sesion'

/**
 * Cascarón de todo lo que exige sesión.
 *
 * La verificación vive AQUÍ y no en cada página: una pantalla nueva queda
 * protegida por el solo hecho de colgar de este grupo, sin que nadie tenga que
 * acordarse de añadir la comprobación. `requireActor` además desvía a cambiar
 * la contraseña si todavía es la que puso un administrador.
 */
export default async function LayoutApp({
  children,
}: {
  children: React.ReactNode
}) {
  const actor = await requireActor()

  return (
    <div className="min-h-dvh bg-white">
      <div className="h-[17px] w-full bg-katana-500" aria-hidden />
      <BarraSesion actor={actor} />
      {children}
    </div>
  )
}
