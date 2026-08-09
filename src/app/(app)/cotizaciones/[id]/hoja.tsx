'use client'

import { useMemo } from 'react'
import { useHoja } from './use-hoja'
import { SelectorRoster } from '@/components/cotizar/selector-roster'
import { BloqueTalento } from '@/components/cotizar/bloque-talento'
import { PanelTotal } from '@/components/cotizar/panel-total'
import { CampoEncabezado } from '@/components/cotizar/campo-encabezado'
import { pendientesDeHoja } from '@/lib/hoja/tipos'
import type { EstadoHoja } from '@/lib/hoja/tipos'
import type { CardRoster } from '@/server/data/catalogo'

/**
 * La hoja de cotización: una sola superficie.
 *
 * Cliente y proyecto arriba como encabezado, el roster para agregar de un tap,
 * los talentos con sus renglones, y el total siempre visible. No hay pantalla
 * previa, ni asistente, ni botón de guardar.
 */

export interface HojaProps {
  inicial: EstadoHoja
  roster: CardRoster[]
  soloLectura: boolean
  motivoSoloLectura?: string
}

export function Hoja({ inicial, roster, soloLectura, motivoSoloLectura }: HojaProps) {
  const h = useHoja(inicial, soloLectura)

  const agregados = useMemo(
    () => new Set(h.doc.talentos.map((t) => t.talentId)),
    [h.doc.talentos],
  )
  const pendientes = useMemo(() => pendientesDeHoja(h.doc), [h.doc])

  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-6 sm:px-6 lg:pb-8">
      {/* ── Encabezado ───────────────────────────────────────────── */}
      <header className="mb-6">
        <p className="text-etiqueta font-mono text-xs tracking-[0.08em]">
          {h.doc.folio ?? h.doc.draftRef}
        </p>
        <CampoEncabezado
          valor={h.doc.cliente}
          disabled={soloLectura}
          placeholder="Cliente"
          aria-label="Cliente"
          onCommit={(v) => void h.cambiarEncabezado({ cliente: v })}
          className="text-2xl font-bold uppercase tracking-[-0.01em] text-katana-800 sm:text-3xl"
        />
        <CampoEncabezado
          valor={h.doc.proyecto ?? ''}
          disabled={soloLectura}
          placeholder="Proyecto"
          aria-label="Proyecto"
          onCommit={(v) => void h.cambiarEncabezado({ proyecto: v || null })}
          className="text-base text-tinta-suave"
        />
      </header>

      {soloLectura && motivoSoloLectura && (
        <p
          data-testid="aviso-solo-lectura"
          className="mb-4 rounded-katana border border-katana-200 bg-katana-50 px-3 py-2 text-sm text-tinta-suave"
        >
          {motivoSoloLectura}
        </p>
      )}

      {h.guardado.fase === 'conflicto' && (
        <div
          data-testid="banner-conflicto"
          role="alert"
          className="mb-4 rounded-katana border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-tinta"
        >
          <p>{h.guardado.mensaje}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            data-touch-target
            className="mt-1.5 min-h-[44px] rounded-katana border border-katana-300 bg-white px-3 text-sm font-medium hover:border-katana-500"
          >
            Volver a cargar
          </button>
        </div>
      )}

      {h.guardado.fase === 'error' && (
        <p role="alert" className="mb-4 rounded-katana border border-red-200 bg-red-50 px-3 py-2 text-sm text-error">
          {h.guardado.mensaje}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="min-w-0 space-y-6">
          {/* ── Talentos agregados ──────────────────────────────── */}
          {h.doc.talentos.length > 0 && (
            <section aria-label="Talentos en la cotización" className="space-y-3">
              {h.doc.talentos.map((t) => (
                <BloqueTalento
                  key={t.id}
                  talento={t}
                  soloLectura={soloLectura}
                  onAgregarRenglon={(f) => void h.agregarRenglon(t.id, f)}
                  onCambiarRenglon={(l, c) => void h.cambiarRenglon(l, c)}
                  onQuitarRenglon={(l) => void h.quitarRenglon(l)}
                  onQuitarTalento={() => void h.quitarTalento(t.id)}
                />
              ))}
            </section>
          )}

          {/* ── Roster ──────────────────────────────────────────── */}
          {!soloLectura && (
            <SelectorRoster
              roster={roster}
              agregados={agregados}
              onAgregar={(id) => void h.agregarTalento(id)}
            />
          )}
        </div>

        {/* ── Total ─────────────────────────────────────────────── */}
        <aside className="hidden lg:block">
          <div className="lg:sticky lg:top-4 space-y-3">
            <PanelTotal
              totales={h.totales}
              moneda={h.doc.moneda}
              ivaBps={h.doc.ivaBps}
              pendientes={pendientes.length}
            />
            <IndicadorGuardado fase={h.guardado.fase} />
          </div>
        </aside>
      </div>

      {/* ── Barra fija en móvil ─────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-katana-200 bg-white p-3 shadow-lg lg:hidden">
        <PanelTotal
          totales={h.totales}
          moneda={h.doc.moneda}
          ivaBps={h.doc.ivaBps}
          pendientes={pendientes.length}
        />
      </div>

      {/* ── Deshacer ────────────────────────────────────────────── */}
      {h.deshacer && (
        <div
          role="status"
          className="fixed bottom-28 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-katana border border-katana-300 bg-katana-950 px-4 py-2.5 text-sm text-white shadow-lg lg:bottom-6"
        >
          <span>{h.deshacer.etiqueta}</span>
          <button
            type="button"
            onClick={() => void h.rehacer()}
            data-touch-target
            className="min-h-[44px] font-semibold text-katana-400 underline underline-offset-2 hover:text-white"
          >
            Deshacer
          </button>
          <button
            type="button"
            onClick={h.descartarDeshacer}
            data-touch-target
            aria-label="Descartar aviso"
            className="min-h-[44px] min-w-[44px] text-katana-400 hover:text-white"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

/** El sistema guarda solo; esto sólo lo dice, discretamente. */
function IndicadorGuardado({ fase }: { fase: string }) {
  const texto =
    fase === 'guardando' ? 'Guardando…'
      : fase === 'guardado' ? 'Guardado'
        : fase === 'error' ? 'No se guardó'
          : fase === 'conflicto' ? 'Conflicto'
            : ''
  if (!texto) return null
  return (
    <p
      data-testid="estado-guardado"
      aria-live="polite"
      className={`text-center text-xs ${fase === 'guardado' ? 'text-exito' : fase === 'guardando' ? 'text-etiqueta' : 'text-error'}`}
    >
      {texto}
    </p>
  )
}
