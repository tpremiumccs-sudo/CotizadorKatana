'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatMXN } from '@/lib/money'
import type {
  PlanImportacion, EntradaPlanTalento, Incidencia, CambioTarifa,
} from '@/server/import/types'

/**
 * Revisión de lo que cambiaría.
 *
 * Es la pantalla que impide que un Excel viejo pise a mano lo que se ajustó en
 * la app, y la que muestra las filas que el parser no supo colocar en vez de
 * tragárselas. Nada se aplica hasta que alguien pulsa el botón del final.
 */

type Decision = 'CONSERVAR_APP' | 'TOMAR_ARCHIVO'

const ETIQUETA_PRECIO: Record<string, string> = {
  QUOTED: '',
  PENDING: 'Pendiente',
  CASE_BY_CASE: 'Caso por caso',
  NOT_APPLICABLE: 'No aplica',
}

function precio(cents: number | null, status: string | null): string {
  if (status === null) return '—'
  if (status === 'QUOTED') return cents === null ? '—' : formatMXN(cents)
  return ETIQUETA_PRECIO[status] ?? status
}

export interface RevisionProps {
  importBatchId: string
  plan: PlanImportacion
  puedeAplicar: boolean
}

export function RevisionImportacion({
  importBatchId, plan, puedeAplicar,
}: RevisionProps) {
  const router = useRouter()
  const [conflictos, setConflictos] = useState<Record<string, Decision>>({})
  const [identidades, setIdentidades] = useState<Record<string, string>>({})
  const [ignorados, setIgnorados] = useState<Set<string>>(new Set())
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const conConflicto = useMemo(
    () =>
      plan.talentos.flatMap((t) =>
        t.cambiosTarifas
          .filter((c) => c.conflicto)
          .map((c) => ({ talento: t, cambio: c })),
      ),
    [plan],
  )

  const dudosos = useMemo(
    () => plan.talentos.filter((t) => t.identidad?.decision === 'REQUIERE_REVISION'),
    [plan],
  )

  const huerfanas = useMemo(
    () => plan.incidencias.filter((i) => i.codigo === 'FILA_HUERFANA'),
    [plan],
  )

  const otras = useMemo(
    () =>
      plan.incidencias.filter(
        (i) => i.codigo !== 'FILA_HUERFANA' && i.severidad !== 'INFO',
      ),
    [plan],
  )

  async function aplicar() {
    setAplicando(true)
    setError(null)
    try {
      const r = await fetch(`/api/importaciones/${importBatchId}/aplicar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conflictos,
          asignaciones: identidades,
          ignorar: [...ignorados],
        }),
      })
      const datos = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        setError(datos.error ?? 'No se pudo aplicar.')
        setAplicando(false)
        return
      }
      router.refresh()
    } catch {
      setError('Sin conexión con el servidor. No se aplicó nada.')
      setAplicando(false)
    }
  }

  return (
    <div className="mt-8 space-y-10">
      <Resumen plan={plan} />

      <HojasDetectadas plan={plan} />

      {dudosos.length > 0 && (
        <Seccion
          titulo="Nombres que no coinciden"
          ayuda={
            'El archivo escribe estos nombres de una forma que no coincide con ' +
            'ningún talento conocido. Confirma a quién corresponde cada uno: la ' +
            'decisión se guarda y en la siguiente importación ya no se pregunta.'
          }
        >
          <ul className="space-y-3">
            {dudosos.map((t) => (
              <li
                key={t.normalizado}
                className="rounded-katana border border-amber-300 bg-amber-50 p-4"
              >
                <p className="font-semibold text-tinta">“{t.crudo}”</p>
                <p className="mt-1 text-sm text-tinta-suave">{t.identidad?.motivo}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(t.identidad?.alternativas ?? []).map((c) => (
                    <button
                      key={c.talentId}
                      type="button"
                      data-touch-target
                      onClick={() =>
                        setIdentidades((prev) => ({
                          ...prev,
                          [t.normalizado]: c.talentId,
                        }))
                      }
                      className={
                        'min-h-[44px] rounded-katana border px-3 text-sm transition-colors ' +
                        (identidades[t.normalizado] === c.talentId
                          ? 'border-katana-500 bg-katana-100 font-semibold text-katana-700'
                          : 'border-katana-200 bg-white text-tinta hover:border-katana-300')
                      }
                    >
                      Es {c.displayName}
                      <span className="ml-2 text-xs text-etiqueta">
                        {(c.puntaje * 100).toFixed(0)}%
                      </span>
                    </button>
                  ))}

                  <button
                    type="button"
                    data-touch-target
                    onClick={() =>
                      setIdentidades((prev) => {
                        const s = { ...prev }
                        delete s[t.normalizado]
                        return s
                      })
                    }
                    className={
                      'min-h-[44px] rounded-katana border px-3 text-sm transition-colors ' +
                      (identidades[t.normalizado] === undefined &&
                      !ignorados.has(t.normalizado)
                        ? 'border-katana-500 bg-katana-100 font-semibold text-katana-700'
                        : 'border-katana-200 bg-white text-tinta hover:border-katana-300')
                    }
                  >
                    Es alguien nuevo
                  </button>

                  <button
                    type="button"
                    data-touch-target
                    onClick={() =>
                      setIgnorados((prev) => {
                        const s = new Set(prev)
                        if (s.has(t.normalizado)) s.delete(t.normalizado)
                        else s.add(t.normalizado)
                        return s
                      })
                    }
                    className={
                      'min-h-[44px] rounded-katana border px-3 text-sm transition-colors ' +
                      (ignorados.has(t.normalizado)
                        ? 'border-katana-500 bg-katana-100 font-semibold text-katana-700'
                        : 'border-katana-200 bg-white text-tinta-suave hover:border-katana-300')
                    }
                  >
                    Ignorar por ahora
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      {conConflicto.length > 0 && (
        <Seccion
          titulo="Precios que se editaron en la app"
          ayuda={
            'Estas tarifas se cambiaron a mano después de la última importación y ' +
            'el archivo trae otra cosa. Por omisión se conserva lo de la app: un ' +
            'Excel viejo no debe pisar un ajuste reciente.'
          }
        >
          <div className="overflow-x-auto rounded-katana border border-katana-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-katana-100 text-left text-xs font-semibold text-tinta">
                <tr>
                  <th scope="col" className="px-3 py-2">Talento</th>
                  <th scope="col" className="px-3 py-2">Formato</th>
                  <th scope="col" className="px-3 py-2 text-right">En la app</th>
                  <th scope="col" className="px-3 py-2 text-right">En el archivo</th>
                  <th scope="col" className="px-3 py-2">Qué hacer</th>
                </tr>
              </thead>
              <tbody>
                {conConflicto.map(({ talento, cambio }) => {
                  const clave = `${talento.talentIdExistente}|${cambio.deliverableCode}`
                  const decision = conflictos[clave] ?? 'CONSERVAR_APP'
                  return (
                    <tr key={clave} className="border-t border-katana-200">
                      <td className="px-3 py-2 font-medium text-tinta">
                        {talento.displayName}
                      </td>
                      <td className="px-3 py-2 text-tinta-suave">
                        {cambio.deliverableNombre}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-precio">
                        {precio(cambio.antesAmountCents, cambio.antesPriceStatus)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-tinta-suave">
                        {precio(cambio.despuesAmountCents, cambio.despuesPriceStatus)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {(
                            [
                              ['CONSERVAR_APP', 'Conservar'],
                              ['TOMAR_ARCHIVO', 'Tomar el archivo'],
                            ] as const
                          ).map(([v, etiqueta]) => (
                            <button
                              key={v}
                              type="button"
                              data-touch-target
                              onClick={() =>
                                setConflictos((prev) => ({ ...prev, [clave]: v }))
                              }
                              className={
                                'min-h-[44px] rounded-katana border px-2 text-xs ' +
                                (decision === v
                                  ? 'border-katana-500 bg-katana-100 font-semibold text-katana-700'
                                  : 'border-katana-200 text-tinta-suave hover:border-katana-300')
                              }
                            >
                              {etiqueta}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Seccion>
      )}

      {huerfanas.length > 0 && (
        <Seccion
          titulo={`Filas con datos que no se pudieron colocar (${huerfanas.length})`}
          ayuda={
            'Tienen contenido pero no dicen a qué talento pertenecen. NO se ' +
            'descartan en silencio: aquí está el volcado crudo de cada una para ' +
            'que puedas revisarlas en el Excel.'
          }
        >
          <ul className="space-y-2">
            {huerfanas.map((i, n) => (
              <IncidenciaFila key={`${i.hoja}-${i.fila}-${n}`} incidencia={i} />
            ))}
          </ul>
        </Seccion>
      )}

      {otras.length > 0 && (
        <Seccion titulo={`Otros avisos (${otras.length})`}>
          <ul className="space-y-2">
            {otras.slice(0, 50).map((i, n) => (
              <IncidenciaFila key={`${i.codigo}-${n}`} incidencia={i} />
            ))}
          </ul>
          {otras.length > 50 && (
            <p className="mt-2 text-xs text-etiqueta">
              Se muestran los primeros 50 de {otras.length}.
            </p>
          )}
        </Seccion>
      )}

      {plan.ausentes.length > 0 && (
        <Seccion
          titulo={`Talentos que el archivo no trae (${plan.ausentes.length})`}
          ayuda={
            'Existen en el sistema y no aparecen en este archivo. NO se borran ni ' +
            'se desactivan: sólo se marcan, porque la ausencia en un Excel no ' +
            'significa que alguien haya dejado la agencia.'
          }
        >
          <p className="text-sm text-tinta-suave">
            {plan.ausentes.map((a) => a.displayName).join(' · ')}
          </p>
        </Seccion>
      )}

      <CambiosPorTalento talentos={plan.talentos} />

      <div className="sticky bottom-0 -mx-4 border-t border-katana-200 bg-white/95
                      px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        {error && (
          <p
            role="alert"
            data-testid="error-aplicar"
            className="mb-3 rounded-katana border border-red-200 bg-red-50 px-3 py-2
                       text-sm text-error"
          >
            {error}
          </p>
        )}
        {puedeAplicar ? (
          <button
            type="button"
            onClick={aplicar}
            disabled={aplicando}
            data-touch-target
            data-testid="boton-aplicar"
            className="min-h-[44px] w-full rounded-katana bg-katana-500 px-5 text-sm
                       font-semibold text-white hover:bg-katana-600
                       disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {aplicando ? 'Aplicando…' : 'Aplicar al tarifario'}
          </button>
        ) : (
          <p className="text-sm text-tinta-suave">
            Aplicar una importación reescribe el tarifario, así que lo hace un
            administrador. Ya puedes pasarle esta revisión.
          </p>
        )}
      </div>
    </div>
  )
}

function Seccion({
  titulo, ayuda, children,
}: {
  titulo: string
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-katana-800">{titulo}</h2>
      {ayuda && <p className="mt-1 max-w-prose text-sm text-tinta-suave">{ayuda}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Resumen({ plan }: { plan: PlanImportacion }) {
  const r = plan.resumen
  const celdas: Array<[string, number, string?]> = [
    ['Talentos en el archivo', r.talentosEnArchivo],
    ['Se darán de alta', r.aCrear],
    ['Se actualizarán', r.aActualizar],
    ['Sin cambios', r.sinCambios],
    ['Tarifas nuevas', r.tarifasNuevas],
    ['Tarifas que cambian', r.tarifasModificadas],
    ['Tarifas en conflicto', r.tarifasEnConflicto, 'alerta'],
    ['Piden revisión', r.requierenRevision, 'alerta'],
    // Aparte de las actualizaciones a propósito: una lectura de seguidores es
    // una observación fechada que se suma al historial, no un dato que cambie.
    ['Lecturas de audiencia', r.metricasNuevas],
  ]
  return (
    <section>
      <h2 className="sr-only">Resumen</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {celdas.map(([etiqueta, valor, tono]) => (
          <div
            key={etiqueta}
            className="rounded-katana border border-katana-200 px-3 py-2"
          >
            <dt className="text-xs text-etiqueta">{etiqueta}</dt>
            <dd
              className={
                'text-xl font-bold tabular-nums ' +
                (tono === 'alerta' && valor > 0 ? 'text-alerta' : 'text-katana-800')
              }
            >
              {valor}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * Qué fila resultó ser el encabezado de cada hoja.
 *
 * No es un detalle técnico: los archivos reales lo tienen en la fila 0, la 1 y
 * la 3 según la hoja, y si el detector se equivoca la importación entera lee
 * columnas corridas. Verlo aquí permite darse cuenta antes de aplicar.
 */
function HojasDetectadas({ plan }: { plan: PlanImportacion }) {
  return (
    <Seccion titulo="Hojas leídas">
      <ul className="space-y-2">
        {plan.hojasDetectadas.map(({ hoja, deteccion }) => (
          <li
            key={hoja}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-katana
                       border border-katana-200 px-3 py-2 text-sm"
          >
            <span className="font-medium text-tinta">{hoja}</span>
            <span className="text-tinta-suave">
              encabezado en la fila {deteccion.filaEncabezado + 1}
            </span>
            <span
              className={
                'text-xs ' +
                (deteccion.requiereMapeoManual ? 'text-alerta' : 'text-etiqueta')
              }
            >
              confianza {(deteccion.confianza * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-etiqueta">
              {deteccion.columnas.length} columna(s) reconocida(s)
            </span>
            {deteccion.columnasSinEncabezado.length > 0 && (
              <span className="text-xs text-alerta">
                {deteccion.columnasSinEncabezado.length} con datos y sin encabezado
              </span>
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  )
}

function IncidenciaFila({ incidencia }: { incidencia: Incidencia }) {
  const color =
    incidencia.severidad === 'ERROR'
      ? 'border-red-200 bg-red-50'
      : 'border-amber-200 bg-amber-50'
  return (
    <li className={`rounded-katana border px-3 py-2 text-sm ${color}`}>
      <p className="text-tinta">{incidencia.mensaje}</p>
      <p className="mt-1 text-xs text-etiqueta">
        {incidencia.hoja}
        {incidencia.fila !== undefined && ` · fila ${incidencia.fila + 1}`} ·{' '}
        {incidencia.codigo}
      </p>
      {incidencia.crudo !== undefined && (
        <pre className="mt-2 overflow-x-auto rounded bg-white/70 p-2 text-xs text-tinta-suave">
          {JSON.stringify(incidencia.crudo)}
        </pre>
      )}
    </li>
  )
}

function CambiosPorTalento({ talentos }: { talentos: EntradaPlanTalento[] }) {
  const conCambios = talentos.filter(
    (t) => t.accion !== 'SIN_CAMBIOS' || t.cambiosTarifas.length > 0,
  )
  const [abierto, setAbierto] = useState(false)

  if (conCambios.length === 0) {
    return (
      <Seccion titulo="Cambios">
        <p className="rounded-katana border border-green-200 bg-green-50 px-3 py-2
                      text-sm text-exito">
          Este archivo no cambia nada. Es lo que se espera al volver a importar
          el mismo Excel.
        </p>
      </Seccion>
    )
  }

  return (
    <Seccion titulo={`Cambios por talento (${conCambios.length})`}>
      <button
        type="button"
        data-touch-target
        onClick={() => setAbierto((v) => !v)}
        className="min-h-[44px] text-sm font-semibold text-katana-500 hover:underline"
      >
        {abierto ? 'Ocultar el detalle' : 'Ver el detalle'}
      </button>

      {abierto && (
        <ul className="mt-3 space-y-3">
          {conCambios.map((t) => (
            <li
              key={t.normalizado}
              className="rounded-katana border border-katana-200 p-3"
            >
              <p className="font-semibold text-tinta">
                {t.displayName}{' '}
                <span className="text-xs font-normal text-etiqueta">
                  {t.accion === 'CREAR' ? 'nuevo' : 'actualizar'}
                  {t.codigo && ` · ${t.codigo}`}
                </span>
              </p>
              {t.cambiosTarifas.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-sm">
                  {t.cambiosTarifas.map((c: CambioTarifa) => (
                    <li key={c.deliverableCode} className="flex flex-wrap gap-2">
                      <span className="text-tinta-suave">{c.deliverableNombre}</span>
                      <span className="tabular-nums text-etiqueta">
                        {precio(c.antesAmountCents, c.antesPriceStatus)}
                      </span>
                      <span aria-hidden>→</span>
                      <span className="tabular-nums font-medium text-precio">
                        {precio(c.despuesAmountCents, c.despuesPriceStatus)}
                      </span>
                      {c.conflicto && (
                        <span className="text-xs font-semibold text-alerta">
                          conflicto
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  )
}
