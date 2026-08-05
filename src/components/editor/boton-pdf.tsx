'use client'

import { useState } from 'react'

/**
 * Descarga del PDF.
 *
 * En iPad y celular ofrece primero `navigator.share`, porque el destino real
 * del documento es un chat de WhatsApp o un correo — no la carpeta de
 * descargas. Si el dispositivo no sabe compartir archivos, cae a la descarga
 * de toda la vida.
 */

export interface BotonPdfProps {
  quoteId: string
  /** Se usa como título al compartir. */
  cliente: string
  /**
   * Por qué no se puede generar ahora mismo. `null` = adelante.
   *
   * El PDF lo dibuja el servidor con lo que tiene guardado, así que con un
   * cambio en vuelo saldría con la cifra vieja — y ese PDF es el que acaba en
   * el correo de la marca. Se espera a que termine de guardar.
   */
  bloqueo?: string | null
}

type Fase = 'listo' | 'generando' | 'error'

export function BotonPdf({ quoteId, cliente, bloqueo }: BotonPdfProps) {
  const [fase, setFase] = useState<Fase>('listo')
  const [mensaje, setMensaje] = useState<string | null>(null)

  async function generar() {
    setFase('generando')
    setMensaje(null)
    try {
      const r = await fetch(`/api/cotizaciones/${quoteId}/pdf`)
      if (!r.ok) {
        const cuerpo = (await r.json().catch(() => ({}))) as { error?: string }
        setMensaje(cuerpo.error ?? 'No se pudo generar el PDF.')
        setFase('error')
        return
      }

      const blob = await r.blob()
      const nombre =
        /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ??
        'documento.pdf'
      const archivo = new File([blob], nombre, { type: 'application/pdf' })

      // `canShare` con el archivo: en escritorio existe `share` pero no acepta
      // archivos, y preguntarlo mal abriría un diálogo que falla.
      if (navigator.canShare?.({ files: [archivo] })) {
        try {
          await navigator.share({
            files: [archivo],
            title: `Tabulador de Tarifas · ${cliente}`,
          })
          setFase('listo')
          return
        } catch (e) {
          // Cancelar el diálogo de compartir no es un error que anunciar.
          if (e instanceof DOMException && e.name === 'AbortError') {
            setFase('listo')
            return
          }
          // Cualquier otro fallo cae a la descarga.
        }
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      URL.revokeObjectURL(url)
      setFase('listo')
    } catch {
      setMensaje('Sin conexión con el servidor. No se pudo generar el PDF.')
      setFase('error')
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={generar}
        disabled={fase === 'generando' || Boolean(bloqueo)}
        title={bloqueo ?? undefined}
        data-touch-target
        data-testid="boton-pdf"
        className="inline-flex min-h-[44px] items-center rounded-katana bg-katana-500
                   px-4 text-sm font-semibold text-white hover:bg-katana-600
                   disabled:cursor-not-allowed disabled:opacity-60"
      >
        {fase === 'generando' ? 'Generando…' : 'Descargar PDF'}
      </button>
      {bloqueo && !mensaje && (
        <p className="max-w-xs text-right text-xs text-etiqueta">{bloqueo}</p>
      )}
      {mensaje && (
        <p
          role="alert"
          data-testid="error-pdf"
          className="max-w-xs text-right text-xs text-error"
        >
          {mensaje}
        </p>
      )}
    </div>
  )
}
