'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  crearUsuarioAccion, actualizarUsuarioAccion, reiniciarPasswordAccion,
  type EstadoAdmin,
} from './acciones'
import { etiquetaRol, type Rol } from '@/lib/authz/policy'

const CAMPO =
  'min-h-[44px] w-full rounded-katana border border-katana-200 bg-white px-3 ' +
  'text-base text-tinta focus:border-katana-500 focus:outline-none'

const ROLES: Rol[] = ['ADMIN', 'COMERCIAL', 'LECTURA']

function Aviso({ estado }: { estado: EstadoAdmin }) {
  if (estado.error) {
    return (
      <p
        role="alert"
        data-testid="error-admin"
        className="rounded-katana border border-red-200 bg-red-50 px-3 py-2 text-sm text-error"
      >
        {estado.error}
      </p>
    )
  }
  if (estado.aviso) {
    return (
      <p
        role="status"
        data-testid="aviso-admin"
        className="rounded-katana border border-green-200 bg-green-50 px-3 py-2 text-sm text-exito"
      >
        {estado.aviso}
      </p>
    )
  }
  return null
}

function Boton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      data-touch-target
      className="min-h-[44px] rounded-katana bg-katana-500 px-4 text-sm font-semibold
                 text-white hover:bg-katana-600 disabled:opacity-60"
    >
      {pending ? 'Guardando…' : children}
    </button>
  )
}

export function FormularioAlta() {
  const [estado, accion] = useActionState<EstadoAdmin, FormData>(crearUsuarioAccion, {})
  const [abierto, setAbierto] = useState(false)

  return (
    <div className="rounded-katana border border-katana-200 p-4">
      <button
        type="button"
        data-touch-target
        onClick={() => setAbierto((v) => !v)}
        className="min-h-[44px] text-sm font-semibold text-katana-500 hover:underline"
      >
        {abierto ? 'Cancelar' : 'Dar de alta a alguien'}
      </button>

      {abierto && (
        <form action={accion} className="mt-4 space-y-4" noValidate>
          <Aviso estado={estado} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="nombre" className="mb-1 block text-sm font-medium text-tinta">
                Nombre completo
              </label>
              <input id="nombre" name="nombre" required className={CAMPO} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-tinta">
                Correo
              </label>
              <input
                id="email" name="email" type="email" required className={CAMPO}
                autoComplete="off" inputMode="email" autoCapitalize="none"
              />
            </div>
            <div>
              <label htmlFor="rol" className="mb-1 block text-sm font-medium text-tinta">
                Rol
              </label>
              <select id="rol" name="rol" defaultValue="COMERCIAL" className={CAMPO}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{etiquetaRol(r)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-tinta">
                Contraseña inicial
              </label>
              <input
                id="password" name="password" type="text" required className={CAMPO}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-etiqueta">
                Mínimo 12 caracteres. Se la das en persona; el sistema le exigirá
                cambiarla al entrar.
              </p>
            </div>
          </div>

          <label className="flex min-h-[44px] items-center gap-2 text-sm text-tinta">
            <input
              type="checkbox" name="esAprobador"
              className="size-4 rounded border-katana-300 text-katana-500"
            />
            Puede aprobar cotizaciones con descuentos grandes
          </label>

          <Boton>Dar de alta</Boton>
        </form>
      )}
    </div>
  )
}

export interface UsuarioFila {
  id: string
  email: string
  nombre: string
  rol: Rol
  estado: string
  esAprobador: boolean
  sesionesAbiertas: number
}

export function AccionesUsuario({
  usuario, esMiCuenta,
}: {
  usuario: UsuarioFila
  esMiCuenta: boolean
}) {
  const [estadoCambio, cambiar] = useActionState<EstadoAdmin, FormData>(
    actualizarUsuarioAccion, {},
  )
  const [estadoReset, resetear] = useActionState<EstadoAdmin, FormData>(
    reiniciarPasswordAccion, {},
  )
  const [reseteando, setReseteando] = useState(false)

  return (
    <div className="mt-3 space-y-3">
      <Aviso estado={estadoCambio.error || estadoCambio.aviso ? estadoCambio : estadoReset} />

      <form action={cambiar} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="usuarioId" value={usuario.id} />

        <div>
          <label
            htmlFor={`rol-${usuario.id}`}
            className="mb-1 block text-xs font-medium text-etiqueta"
          >
            Rol
          </label>
          <select
            id={`rol-${usuario.id}`} name="rol" defaultValue={usuario.rol}
            className="min-h-[44px] rounded-katana border border-katana-200 px-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{etiquetaRol(r)}</option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={`estado-${usuario.id}`}
            className="mb-1 block text-xs font-medium text-etiqueta"
          >
            Estado
          </label>
          <select
            id={`estado-${usuario.id}`} name="estado" defaultValue={usuario.estado}
            className="min-h-[44px] rounded-katana border border-katana-200 px-2 text-sm"
          >
            <option value="ACTIVO">Activo</option>
            <option value="SUSPENDIDO">Suspendido</option>
            <option value="DESACTIVADO">Desactivado</option>
          </select>
        </div>

        <label className="flex min-h-[44px] items-center gap-2 text-sm text-tinta">
          <input
            type="checkbox" name="esAprobador" defaultChecked={usuario.esAprobador}
            className="size-4 rounded border-katana-300 text-katana-500"
          />
          Aprueba
        </label>

        <Boton>Guardar</Boton>
      </form>

      {esMiCuenta && (
        <p className="text-xs text-alerta">
          Es tu propia cuenta: si te bajas el rol, perderás el acceso a esta
          pantalla en el acto.
        </p>
      )}

      {reseteando ? (
        <form action={resetear} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="usuarioId" value={usuario.id} />
          <div className="min-w-[220px] flex-1">
            <label
              htmlFor={`pass-${usuario.id}`}
              className="mb-1 block text-xs font-medium text-etiqueta"
            >
              Contraseña nueva (se la das en persona)
            </label>
            <input
              id={`pass-${usuario.id}`} name="password" type="text" required
              autoComplete="off"
              className="min-h-[44px] w-full rounded-katana border border-katana-200 px-2 text-sm"
            />
          </div>
          <Boton>Reiniciar</Boton>
          <button
            type="button"
            data-touch-target
            onClick={() => setReseteando(false)}
            className="min-h-[44px] px-3 text-sm text-tinta-suave hover:underline"
          >
            Cancelar
          </button>
        </form>
      ) : (
        <button
          type="button"
          data-touch-target
          onClick={() => setReseteando(true)}
          className="min-h-[44px] text-sm font-medium text-katana-500 hover:underline"
        >
          Reiniciar su contraseña
          {usuario.sesionesAbiertas > 0 &&
            ` (cerrará ${usuario.sesionesAbiertas} sesión(es))`}
        </button>
      )}
    </div>
  )
}
