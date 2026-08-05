import { NextResponse } from 'next/server'
import { leerEditor, registrarDescarga } from '@/server/data/cotizacion'
import { renderPdf, DesbordamientoError, logoDataUri } from '@/server/pdf/render'
import { nombreArchivo } from '@/server/pdf/nombre-archivo'
import { documentoDesdeEditor } from '@/lib/editor/tipos'
import { ForbiddenError } from '@/lib/authz/policy'

/**
 * Descarga del PDF.
 *
 * Es el mismo documento que se está viendo en la vista previa: sale de la misma
 * función, con los mismos datos. Lo que Chuy enseña en la junta y lo que recibe
 * la marca no pueden diferir porque no hay dos caminos.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const estado = await leerEditor(id)
    if (!estado) {
      return NextResponse.json({ error: 'No existe esa cotización.' }, { status: 404 })
    }

    const doc = documentoDesdeEditor(estado, logoDataUri())
    const { bytes, paginas, ms } = await renderPdf(doc)

    const archivo = nombreArchivo({
      tipo: 'TABULADOR',
      cliente: estado.cliente,
      folio: estado.folio,
      fecha: new Date(),
    })

    await registrarDescarga(id, archivo, paginas)

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/pdf',
        // `attachment` para que el iPad ofrezca "Compartir" en vez de abrirlo
        // en una pestaña de la que ya no se puede mandar por WhatsApp.
        'content-disposition': `attachment; filename="${archivo}"`,
        'content-length': String(bytes.length),
        'cache-control': 'no-store, private',
        'x-generacion-ms': String(ms),
      },
    })
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 })
    }
    if (e instanceof DesbordamientoError) {
      // Se responde con el problema, NO con un PDF recortado: un documento al
      // que le falta un renglón es peor que ningún documento.
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? `No se pudo generar el PDF: ${e.message}`
            : 'No se pudo generar el PDF.',
      },
      { status: 500 },
    )
  }
}
