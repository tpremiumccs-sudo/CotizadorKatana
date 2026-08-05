'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderDocumentBody } from '@/lib/doc/render'
import { PAGINA } from '@/lib/doc/metricas'
import { documentoDesdeEditor, type EstadoEditor } from '@/lib/editor/tipos'

/**
 * Vista previa en vivo.
 *
 * El documento vive en un iframe de mismo origen por una razón concreta: sin
 * él, el preflight de Tailwind y el `line-height` heredado de la app se
 * filtrarían al documento y la vista previa dejaría de coincidir con el PDF.
 * Dentro del iframe sólo hay el CSS del documento.
 *
 * El iframe carga UNA vez el documento completo —con las fuentes embebidas, que
 * son lo caro— y en cada tecleo se reemplaza únicamente el cuerpo, con la misma
 * función que usa el servidor para imprimir. Volver a escribir el documento
 * entero obligaría a redecodificar las fuentes en cada pulsación, que es
 * justamente lo que hace que una vista previa se sienta lenta.
 *
 * Nada se inyecta dentro del iframe: ni un margen entre páginas ni una sombra.
 * Lo que se ve es exactamente lo que se imprime.
 */

export interface PanelPreviewProps {
  estado: EstadoEditor
  logoDataUri: string
  /** Ruta que sirve el documento completo la primera vez. */
  src: string
  /** Milisegundos que tardó el último repintado; sólo para la barra de estado. */
  onMedir?(ms: number): void
}

export function PanelPreview({ estado, logoDataUri, src, onMedir }: PanelPreviewProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  const [listo, setListo] = useState(false)
  const [escala, setEscala] = useState(1)
  const [paginas, setPaginas] = useState(1)

  // El documento mide 612 pt de ancho fijo. En un celular eso no cabe, así que
  // se escala al ancho disponible en vez de dejar que la página se desborde en
  // horizontal.
  useEffect(() => {
    const el = contenedor.current
    if (!el) return
    const medir = () => setEscala(Math.min(1, el.clientWidth / PAGINA.ancho))
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  const repintar = useCallback(() => {
    const doc = ref.current?.contentDocument
    if (!doc?.body) return
    const t0 = performance.now()
    doc.body.innerHTML = renderDocumentBody(documentoDesdeEditor(estado, logoDataUri))
    setPaginas(Math.max(1, doc.querySelectorAll('.pagina').length))
    onMedir?.(performance.now() - t0)
  }, [estado, logoDataUri, onMedir])

  useEffect(() => {
    if (listo) repintar()
  }, [listo, repintar])

  const alto = PAGINA.alto * paginas

  return (
    <div ref={contenedor} className="w-full">
      <div
        // El iframe se escala con `transform`, que NO cambia el hueco que ocupa
        // en el flujo: sin este envoltorio quedaría una franja en blanco del
        // tamaño sin escalar.
        style={{ width: PAGINA.ancho * escala, height: alto * escala }}
        className="mx-auto bg-white shadow-sm ring-1 ring-katana-200"
      >
        <iframe
          ref={ref}
          src={src}
          title="Vista previa del documento"
          onLoad={() => setListo(true)}
          scrolling="no"
          style={{
            width: PAGINA.ancho,
            height: alto,
            transform: `scale(${escala})`,
            transformOrigin: 'top left',
            border: 0,
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}
