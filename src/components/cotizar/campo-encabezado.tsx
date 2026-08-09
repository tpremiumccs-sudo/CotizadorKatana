'use client'

import { useEffect, useState } from 'react'

/**
 * Cliente y proyecto: encabezado editable, no formulario.
 *
 * Es un `input` sin caja que sólo se dibuja al enfocarlo, para que el
 * encabezado se lea como el título del documento y no como un campo
 * administrativo — pero siga siendo obvio que se puede tocar.
 *
 * Confirma al salir del campo o con Enter, igual que el resto de la hoja.
 */

export interface CampoEncabezadoProps {
  valor: string
  onCommit(valor: string): void
  placeholder: string
  'aria-label': string
  className?: string
  disabled?: boolean
}

export function CampoEncabezado({
  valor, onCommit, placeholder, className, disabled, ...resto
}: CampoEncabezadoProps) {
  const [texto, setTexto] = useState(valor)
  const [enfocado, setEnfocado] = useState(false)

  // Si cambia desde fuera se sigue, salvo mientras se escribe en él.
  useEffect(() => { if (!enfocado) setTexto(valor) }, [valor, enfocado])

  function confirmar() {
    const limpio = texto.trim()
    if (limpio === valor.trim()) return
    onCommit(limpio)
  }

  return (
    <input
      {...resto}
      type="text"
      value={texto}
      disabled={disabled}
      placeholder={placeholder}
      data-touch-target
      onChange={(e) => setTexto(e.target.value)}
      onFocus={() => setEnfocado(true)}
      onBlur={() => { setEnfocado(false); confirmar() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
        if (e.key === 'Escape') { setTexto(valor); e.currentTarget.blur() }
      }}
      className={[
        'min-h-[44px] w-full rounded-katana border border-transparent bg-transparent px-2 -mx-2',
        'placeholder:text-etiqueta placeholder:font-normal',
        'hover:border-katana-200 focus:border-katana-500 focus:bg-white focus:outline-none',
        'disabled:hover:border-transparent',
        className ?? '',
      ].join(' ')}
    />
  )
}
