'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { MatrizPrecios } from '@/components/editor/matriz-precios'
import { PanelPreview } from '@/components/editor/panel-preview'
import { BotonPdf } from '@/components/editor/boton-pdf'
import { crearTienda, type Tienda, type EstadoGuardado } from './store'
import type { EstadoEditor, EstadoPrecioEditor } from '@/lib/editor/tipos'

/**
 * El editor: matriz a la izquierda, documento a la derecha.
 *
 * Lo tecleado se ve en el documento de inmediato y se guarda después. Los dos
 * pasos están separados a propósito: esperar al servidor para repintar haría
 * que escribir un precio se sintiera como rellenar un formulario, cuando lo que
 * se está haciendo es enseñar un documento en una junta.
 */

/** Espera tras la última pulsación antes de mandar el cambio. */
const ESPERA_GUARDADO_MS = 450

type Cambio = { status: EstadoPrecioEditor | null; amountCents: number | null }

export interface EditorProps {
  inicial: EstadoEditor
  logoDataUri: string
  soloLectura: boolean
  motivoSoloLectura?: string
}

export function Editor({
  inicial, logoDataUri, soloLectura, motivoSoloLectura,
}: EditorProps) {
  const tienda = useMemo(() => crearTienda(inicial), [inicial])
  const doc = useStore(tienda, (s: Tienda) => s.doc)
  const guardado = useStore(tienda, (s: Tienda) => s.guardado)
  const sucias = useStore(tienda, (s: Tienda) => s.sucias)
  const [msPreview, setMsPreview] = useState<number | null>(null)
  const [vista, setVista] = useState<'editor' | 'documento'>('editor')

  // Cambios en vuelo, por celda: si se teclea tres veces seguidas sólo se manda
  // el último valor, y el temporizador anterior se cancela.
  const temporizadores = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pendientes = temporizadores.current
    return () => pendientes.forEach(clearTimeout)
  }, [])

  function programarGuardado(clave: string) {
    const previo = temporizadores.current.get(clave)
    if (previo) clearTimeout(previo)
    temporizadores.current.set(
      clave,
      setTimeout(() => {
        temporizadores.current.delete(clave)
        void guardar(clave)
      }, ESPERA_GUARDADO_MS),
    )
  }

  async function guardar(clave: string) {
    const s = tienda.getState()
    const celda = s.doc.celdas[clave]
    if (!celda) return
    if (s.guardado.fase === 'conflicto') return

    s.marcarGuardando()
    try {
      const r = await fetch(`/api/cotizaciones/${s.doc.quoteId}/precio`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          // El bloqueo optimista: "aplica esto sólo si la revisión sigue siendo
          // la que vi cuando abrí la pantalla".
          'if-match': String(s.doc.revision),
        },
        body: JSON.stringify({
          quotePriceId: celda.id,
          status: celda.overridePriceStatus,
          amountCents: celda.overrideAmountCents,
        }),
      })

      if (r.status === 409) {
        const cuerpo = (await r.json()) as { error: string; quien: string | null }
        tienda.getState().entrarEnConflicto(cuerpo.error, cuerpo.quien)
        return
      }
      if (!r.ok) {
        const cuerpo = (await r.json().catch(() => ({}))) as { error?: string }
        tienda.getState().fallarGuardado(clave, cuerpo.error ?? 'No se pudo guardar.')
        return
      }

      const cuerpo = (await r.json()) as {
        revision: number
        celda: NonNullable<EstadoEditor['celdas'][string]>
      }
      tienda.getState().aplicarGuardado(clave, cuerpo.celda, cuerpo.revision)
    } catch {
      tienda
        .getState()
        .fallarGuardado(clave, 'Sin conexión con el servidor. El cambio no se guardó.')
    }
  }

  function alCambiar(clave: string, cambio: Cambio) {
    tienda.getState().ajustarPrecio(clave, cambio)
    programarGuardado(clave)
  }

  function alRevertir(clave: string) {
    tienda.getState().revertir(clave)
    programarGuardado(clave)
  }

  const rutaPreview = `/api/cotizaciones/${doc.quoteId}/preview`

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <Encabezado doc={doc} guardado={guardado} msPreview={msPreview} />

      {guardado.fase === 'conflicto' && <BannerConflicto guardado={guardado} />}
      {guardado.fase === 'error' && (
        <p
          role="alert"
          data-testid="error-guardado"
          className="mt-3 rounded-katana border border-red-200 bg-red-50 px-3 py-2
                     text-sm text-error"
        >
          {guardado.mensaje}
        </p>
      )}
      {soloLectura && motivoSoloLectura && (
        <p
          data-testid="aviso-solo-lectura"
          className="mt-3 rounded-katana border border-katana-200 bg-katana-100 px-3
                     py-2 text-sm text-tinta-suave"
        >
          {motivoSoloLectura}
        </p>
      )}

      {/* En celular no caben las dos cosas: se alternan con un segmentado.
          A partir de iPad vertical van lado a lado. */}
      <div className="mt-4 flex gap-1 rounded-katana bg-katana-100 p-1 lg:hidden">
        {(['editor', 'documento'] as const).map((v) => (
          <button
            key={v}
            type="button"
            data-touch-target
            aria-pressed={vista === v}
            onClick={() => setVista(v)}
            className={
              'min-h-[44px] flex-1 rounded-katana text-sm font-semibold transition-colors ' +
              (vista === v ? 'bg-white text-katana-700 shadow-sm' : 'text-tinta-suave')
            }
          >
            {v === 'editor' ? 'Precios' : 'Documento'}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        {/*
          `min-w-0` no es cosmético: sin él la columna de la rejilla crece hasta
          el ancho mínimo de la tabla (560 px) y en un celular la página entera
          se desborda en horizontal, en vez de que la tabla se desplace dentro
          de su propio contenedor.
        */}
        <section
          aria-label="Precios"
          className={'min-w-0 ' + (vista === 'editor' ? '' : 'hidden lg:block')}
        >
          <MatrizPrecios
            estado={doc}
            soloLectura={soloLectura}
            sucias={sucias}
            onCambiar={alCambiar}
            onRevertir={alRevertir}
            onSeleccionar={(c) => tienda.getState().seleccionar(c)}
          />
          <p className="mt-3 text-xs leading-relaxed text-etiqueta">
            Escribe el precio y sal del campo para guardarlo. El menú ⋯ de cada
            celda permite marcarla como pendiente, caso por caso o no aplica, y
            volver al precio del tarifario.
          </p>
        </section>

        <section
          aria-label="Vista previa del documento"
          className={'min-w-0 ' + (vista === 'documento' ? '' : 'hidden lg:block')}
        >
          <div className="lg:sticky lg:top-4">
            <PanelPreview
              estado={doc}
              logoDataUri={logoDataUri}
              src={rutaPreview}
              onMedir={setMsPreview}
            />
          </div>
        </section>
      </div>
    </main>
  )
}

function Encabezado({
  doc, guardado, msPreview,
}: {
  doc: EstadoEditor
  guardado: EstadoGuardado
  msPreview: number | null
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-[0.14em] text-katana-500">
          {doc.folio ?? doc.draftRef}
        </p>
        <h1 className="truncate text-2xl font-bold tracking-tight text-katana-800">
          {doc.titulo} · {doc.cliente}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {msPreview !== null && (
          <span
            data-testid="ms-preview"
            data-ms={msPreview.toFixed(1)}
            className="hidden text-xs text-etiqueta sm:inline"
          >
            vista previa {msPreview.toFixed(0)} ms
          </span>
        )}
        <IndicadorGuardado guardado={guardado} />
        <BotonPdf
          quoteId={doc.quoteId}
          cliente={doc.cliente}
          bloqueo={bloqueoPdf(guardado)}
        />
      </div>
    </header>
  )
}

/**
 * Cuándo NO se debe poder bajar el PDF.
 *
 * El PDF lo dibuja el servidor con lo que tiene guardado. Con un cambio en
 * vuelo saldría con la cifra vieja, y ese archivo es el que acaba en el correo
 * de la marca — es de las pocas cosas del sistema que no se pueden corregir
 * después.
 */
function bloqueoPdf(guardado: EstadoGuardado): string | null {
  switch (guardado.fase) {
    case 'pendiente':
    case 'guardando':
      return 'Espera a que termine de guardar: el PDF saldría con la cifra anterior.'
    case 'error':
      return 'Hay un cambio que no se guardó. Corrígelo antes de generar el PDF.'
    case 'conflicto':
      return 'Vuelve a cargar antes de generar el PDF: esta pestaña tiene una versión vieja.'
    default:
      return null
  }
}

/**
 * Estado del guardado.
 *
 * Se dice siempre, sin sutilezas: quien está enseñando el documento a una marca
 * necesita saber si lo que ve ya quedó registrado.
 */
function IndicadorGuardado({ guardado }: { guardado: EstadoGuardado }) {
  const texto: Record<EstadoGuardado['fase'], string> = {
    limpio: 'Sin cambios',
    pendiente: 'Sin guardar…',
    guardando: 'Guardando…',
    guardado: 'Guardado',
    error: 'No se guardó',
    conflicto: 'Conflicto',
  }
  const color: Record<EstadoGuardado['fase'], string> = {
    limpio: 'text-etiqueta',
    pendiente: 'text-alerta',
    guardando: 'text-alerta',
    guardado: 'text-exito',
    error: 'text-error',
    conflicto: 'text-error',
  }
  return (
    <span
      data-testid="estado-guardado"
      data-fase={guardado.fase}
      aria-live="polite"
      className={`text-sm font-medium ${color[guardado.fase]}`}
    >
      {texto[guardado.fase]}
    </span>
  )
}

function BannerConflicto({
  guardado,
}: {
  guardado: Extract<EstadoGuardado, { fase: 'conflicto' }>
}) {
  return (
    <div
      role="alert"
      data-testid="banner-conflicto"
      className="mt-3 rounded-katana border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <p className="text-sm font-semibold text-alerta">{guardado.mensaje}</p>
      <p className="mt-1 text-sm text-tinta-suave">
        Para no pisar su trabajo, esta pestaña dejó de guardar. Lo que escribiste
        sigue en pantalla: cópialo si lo necesitas y vuelve a cargar para
        continuar sobre la versión más reciente.
      </p>
      <button
        type="button"
        data-touch-target
        onClick={() => window.location.reload()}
        className="mt-3 min-h-[44px] rounded-katana bg-katana-500 px-4 text-sm
                   font-semibold text-white hover:bg-katana-600"
      >
        Volver a cargar
      </button>
    </div>
  )
}
