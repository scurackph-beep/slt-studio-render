# USER-FLOWS-FINAL.md

Fecha: 2026-07-12  
Proyecto: Sweet Little Trauma Studio

## 1. Visitante abre Home

1. Entra a `/`.
2. Ve la navegacion principal, credit badge y perfil.
3. Escribe una intencion en el chat de Home o usa botones rapidos.
4. La Home sugiere el estudio correspondiente.
5. Abre Image, Video, Music, Sound, Fashion, Engineering o Assist.

Validacion: los links de navegacion existen en `src/App.jsx`.

## 2. Crear imagen con referencia

1. Usuario abre `/image`.
2. Elige herramienta, provider y ratio.
3. Escribe prompt.
4. Opcional: sube referencia con `ReferenceUploader`.
5. Click en Generate.
6. Backend modera input.
7. Backend reserva creditos.
8. Gateway llama provider.
9. Si hay resultado, se guarda en storage local/CDN.
10. UI muestra estado y output.
11. Asset aparece en `/library`.

## 3. Crear video con referencia

1. Usuario abre `/video`.
2. Elige accion: Lip Sync, Motion Transfer, Scene Transfer, Image to Video o Text to Video.
3. Elige provider, duracion y ratio.
4. Sube video/audio/imagen de referencia si aplica.
5. Genera.
6. Backend responde HTTP 202 si el proceso es largo.
7. UI consulta `/api/jobs/:jobId`.
8. Webhook marca completed/failed.
9. Si completed: asset queda en `/cdn/assets/...` y se captura credito.
10. Si failed: se liberan creditos.

## 4. Crear musica o audio

1. Usuario abre `/music` o `/sound`.
2. Elige tool y provider.
3. Escribe prompt.
4. Opcional: sube tarareo, voz, letra o referencia.
5. Genera.
6. Backend estima costo segun tipo.
7. Backend modera y reserva creditos.
8. Resultado queda como asset propio si el provider devuelve archivo.

## 5. Formularios de contacto

1. Usuario abre `/contact` o navega desde paginas corporativas.
2. Elige tipo: soporte, careers, ventas, bug, recovery, cancelacion.
3. Completa email opcional/valido y mensaje.
4. Backend valida.
5. Solicitud queda en `state.forms`.

Pendiente para produccion: guardar en DB y/o enviar a email/CRM.

## 6. Libreria de assets

1. Usuario abre `/library`.
2. Backend devuelve assets accesibles para su identidad.
3. Usuario puede previsualizar, descargar o borrar.
4. Delete elimina metadata y archivo local si existe.

## 7. Perfil y modo CEO

1. Usuario abre `/profile`.
2. Login local crea sesion.
3. CEO puede refrescar estado de providers desde rutas protegidas.
4. Ledger visible se actualiza desde el contexto.

Pendiente para produccion: reemplazar login local por Auth real.

## 8. Modulos no listos

Fashion y Engineering no ejecutan generacion falsa. Muestran Coming Soon y acciones deshabilitadas hasta que exista pipeline real.

