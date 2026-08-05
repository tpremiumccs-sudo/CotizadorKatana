import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { leerTalento } from '@/server/data/talentos'
import { formatMXN } from '@/lib/money'

export const metadata: Metadata = { title: 'Talento' }

const numero = new Intl.NumberFormat('es-MX')

const ETIQUETA_PRECIO: Record<string, string> = {
  PENDING: 'Pendiente',
  CASE_BY_CASE: 'Caso por caso',
  NOT_APPLICABLE: 'No aplica',
}

export default async function PaginaTalento({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const t = await leerTalento(slug)
  if (!t) notFound()

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <nav className="mb-4">
        <Link href="/talentos" className="text-sm font-semibold text-katana-500 hover:underline">
          ← Talentos
        </Link>
      </nav>

      <h1 className="text-2xl font-bold tracking-tight text-katana-800">{t.nombre}</h1>
      <p className="mt-1 text-sm text-tinta-suave">
        {[t.codigo, t.nombreCanonico !== t.nombre ? t.nombreCanonico : null,
          t.categoria, t.relacion, [t.ciudad, t.pais].filter(Boolean).join(', ') || null]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {t.esMenorDeEdad && (
        <div
          role="note"
          className="mt-4 rounded-katana border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <p className="text-sm font-semibold text-alerta">Talento menor de edad</p>
          <p className="mt-1 text-sm text-tinta-suave">
            No se guarda ningún dato personal suyo en el sistema. Cualquier
            contratación requiere consentimiento de quien ejerza la patria
            potestad y revisión legal antes de emitir.
          </p>
        </div>
      )}

      {t.ausente && (
        <p className="mt-4 rounded-katana border border-katana-200 bg-katana-100 px-4 py-3
                      text-sm text-tinta-suave">
          El último archivo importado no lo traía. No se ha borrado nada: sólo
          queda señalado por si dejó la agencia o por si cambió de nombre en el
          Excel.
        </p>
      )}

      <Seccion titulo="Tarifas">
        {t.tarifas.length === 0 ? (
          <p className="text-sm text-etiqueta">Sin tarifas cargadas.</p>
        ) : (
          <ul className="divide-y divide-katana-200 rounded-katana border border-katana-200">
            {t.tarifas.map((r) => (
              <li key={r.formato} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-tinta">{r.formato}</span>
                {r.editadaAMano && (
                  <span className="text-xs text-etiqueta">editada a mano</span>
                )}
                <span
                  className={
                    'tabular-nums font-semibold ' +
                    (r.priceStatus === 'QUOTED' ? 'text-precio' : 'text-etiqueta')
                  }
                >
                  {r.priceStatus === 'QUOTED' && r.amountCents !== null
                    ? formatMXN(r.amountCents)
                    : (ETIQUETA_PRECIO[r.priceStatus] ?? '—')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {t.notasTarifa && (
          <div className="mt-3 rounded-katana border border-katana-200 bg-katana-50 p-3">
            <p className="text-xs font-semibold text-tinta">Notas de tarifa</p>
            {/* Se preserva ÍNTEGRA y sin interpretar: la de Padigol trae un
                tarifario de paquetes en prosa que ningún parser debe tocar. */}
            <p className="mt-1 whitespace-pre-wrap text-sm text-tinta-suave">
              {t.notasTarifa}
            </p>
          </div>
        )}
      </Seccion>

      {t.metricas.length > 0 && (
        <Seccion titulo="Audiencia">
          <ul className="grid gap-2 sm:grid-cols-2">
            {t.metricas.map((m) => (
              <li
                key={m.plataforma}
                className="rounded-katana border border-katana-200 px-3 py-2"
              >
                <p className="text-xs text-etiqueta">{m.plataforma}</p>
                <p className="text-lg font-bold tabular-nums text-katana-800">
                  {m.seguidores !== null ? numero.format(m.seguidores) : 'sin dato'}
                </p>
                {/* El valor crudo se conserva porque el archivo trae cosas como
                    "99.1.K" y "48.9K aprox. — validar": el número interpretado
                    no basta para decidir si fiarse. */}
                <p className="text-xs text-etiqueta">
                  del archivo: “{m.crudo}”
                  {m.requiereRevision && ' · revisar'}
                </p>
                {m.notas.length > 0 && (
                  <p className="mt-1 text-xs text-alerta">{m.notas.join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      {t.notasComerciales && (
        <Seccion titulo="Ángulo comercial">
          {/* Es lo que la agencia escribió en el CRM sobre cómo vender a este
              talento: quién tiene que aprobar, qué condiciones aplican, qué
              está pendiente. Se muestra íntegro. */}
          <p className="whitespace-pre-wrap rounded-katana border border-katana-200
                        bg-katana-50 p-3 text-sm text-tinta-suave">
            {t.notasComerciales}
          </p>
        </Seccion>
      )}

      {(t.notaPlataforma || t.enlaces.length > 0 || t.usuario) && (
        <Seccion titulo="Plataformas">
          {t.usuario && (
            <p className="text-sm text-tinta-suave">Usuario: {t.usuario}</p>
          )}
          {t.enlaces.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {t.enlaces.map((e) => (
                <li key={e.plataforma}>
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    data-touch-target
                    className="inline-flex min-h-[44px] items-center rounded-katana
                               border border-katana-200 px-3 text-sm font-medium
                               text-katana-600 hover:bg-katana-100"
                  >
                    {e.plataforma} ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          {t.notaPlataforma && (
            <p className="mt-2 text-sm text-tinta-suave">{t.notaPlataforma}</p>
          )}
        </Seccion>
      )}

      {(t.bio || t.logros || t.campanas) && (
        <Seccion titulo="Ficha">
          {t.bio && <p className="whitespace-pre-wrap text-sm text-tinta-suave">{t.bio}</p>}
          {t.logros && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-tinta">Logros</h3>
              <p className="whitespace-pre-wrap text-sm text-tinta-suave">{t.logros}</p>
            </>
          )}
          {t.campanas && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-tinta">Campañas</h3>
              <p className="whitespace-pre-wrap text-sm text-tinta-suave">{t.campanas}</p>
            </>
          )}
        </Seccion>
      )}

      <Seccion titulo="Nombres con los que aparece">
        {/* Es lo que evita que la próxima importación lo duplique: cada forma
            confirmada queda registrada y ya no se vuelve a preguntar. */}
        <ul className="flex flex-wrap gap-2">
          {t.identificadores.map((i) => (
            <li
              key={i.normalizado}
              className={
                'rounded-katana border px-3 py-1 text-sm ' +
                (i.canonico
                  ? 'border-katana-400 bg-katana-100 font-medium text-katana-700'
                  : 'border-katana-200 text-tinta-suave')
              }
              title={`${i.origen}${i.canonico ? ' · canónico' : ''}`}
            >
              {i.raw}
            </li>
          ))}
        </ul>
      </Seccion>
    </main>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-katana-800">{titulo}</h2>
      {children}
    </section>
  )
}
