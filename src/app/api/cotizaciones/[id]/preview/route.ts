import { NextResponse } from 'next/server'
import { leerEditor } from '@/server/data/cotizacion'
import { fuentesDocumento, logoDataUri } from '@/server/pdf/fuentes'
import { renderDocumentHtml } from '@/lib/doc/render'
import { documentoDesdeEditor } from '@/lib/editor/tipos'
import { ForbiddenError } from '@/lib/authz/policy'

/**
 * El documento que carga el iframe de la vista previa.
 *
 * Sirve el HTML completo UNA vez —con las fuentes embebidas, que son lo caro—
 * y a partir de ahí el editor sólo reemplaza el cuerpo en cada tecleo, sin
 * volver a pedir nada. Es el mismo HTML que imprime Chromium.
 *
 * No lleva token de render ni nada parecido: es una ruta autenticada como
 * cualquier otra, y el iframe la carga con la cookie de sesión del usuario.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const estado = await leerEditor(id)
    if (!estado) {
      return new NextResponse('No existe esa cotización.', { status: 404 })
    }

    const html = renderDocumentHtml(
      documentoDesdeEditor(estado, logoDataUri()),
      fuentesDocumento(),
      'preview',
    )

    return new NextResponse(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Es información comercial confidencial: no se guarda en ninguna caché
        // intermedia, y menos detrás de un túnel compartido.
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return new NextResponse(e.message, { status: 403 })
    }
    throw e
  }
}
