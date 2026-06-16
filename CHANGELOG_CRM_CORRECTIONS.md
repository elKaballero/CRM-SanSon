# Registro de Cambios y Correcciones de Sincronización - CRM SanSon

Este archivo sirve como referencia histórica de las correcciones de sincronización y fecha aplicadas al CRM. Si eres un asistente de IA trabajando en este proyecto en el futuro, lee esto para entender la arquitectura y las soluciones a los problemas de sincronización de WhatsApp.

---

## 1. Problemas Diagnosticados y Soluciones

### A. Fallo en la persistencia de mensajes (Pérdida de historial)
* **Problema**: El CRM almacenaba los mensajes en una variable en RAM en el backend. Cuando el servidor de Render se reiniciaba por inactividad (plan gratuito), se borraba todo el historial de chats.
* **Solución**: Se creó una tabla `messages` en PostgreSQL (Supabase) y se implementó persistencia real en el backend.
  * Archivos modificados: [database.sql](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/database.sql), [whatsappService.js](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/whatsappService.js).

### B. Fallo en la agrupación de chats (Multi-device JIDs)
* **Problema**: En WhatsApp Web multi-device, los identificadores de remitente (JID) vienen acompañados por un ID de dispositivo (ej: `584249753350:3@s.whatsapp.net`). Esto provocaba que los mensajes de un mismo contacto se separaran en múltiples chats diferentes o no se pudieran comparar correctamente en el frontend.
* **Solución**: Se creó la función `normalizeJid` en backend y frontend para eliminar el sufijo `:deviceId` antes de guardar o filtrar chats.
  * Archivos modificados: [whatsappService.js](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/whatsappService.js), [frontend/src/pages/ChatWindow.jsx](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/frontend/src/pages/ChatWindow.jsx).

### C. Error de Fecha Inválida ("Invalid Date") en el Frontend
* **Problema**: Las fechas de los mensajes mostraban "Invalid Date". Esto pasaba porque PostgreSQL retorna los campos `BIGINT` (usados para el timestamp en milisegundos) como strings en JavaScript para evitar desbordamientos de enteros. Al pasar este string directamente a `new Date("1718563820000")`, el navegador fallaba.
* **Solución**: Se modificó el frontend en `ChatWindow.jsx` para convertir de manera segura los strings numéricos de fecha a números de JavaScript antes de instanciar `Date` (ej: `parseInt(ts, 10)`).
  * Archivo modificado: [frontend/src/pages/ChatWindow.jsx](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/frontend/src/pages/ChatWindow.jsx).

### D. Fallo en el envío de respuestas - Identidad de línea (@lid) de WhatsApp
* **Problema**: WhatsApp implementó identificadores de línea llamados **LID** (ej: `46389975335013@lid`) para cuentas asociadas o nuevas políticas. Al recibir un mensaje del usuario, venía con este JID de tipo `@lid`. Sin embargo, al responder desde el CRM, el backend forzaba el dominio a `@s.whatsapp.net` (`46389975335013@s.whatsapp.net`), el cual no existe para WhatsApp y las respuestas nunca llegaban al teléfono del remitente original.
* **Solución**: 
  1. Se actualizó la función `sendMessage` en el backend para preservar el dominio `@lid` si está presente en el JID de destino.
  2. Se agregó una migración automática temporal en `index.js` para fusionar en la base de datos los registros antiguos que tenían el JID incorrecto hacia la versión `@lid`.
  * Archivos modificados: [whatsappService.js](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/whatsappService.js), [index.js](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/index.js).

---

## 2. Instrucciones Críticas de Mantenimiento y Despliegue

### Esquema de Base de Datos (Supabase)
Si reinstalas la base de datos o se borran las tablas, debes ejecutar el script completo de [database.sql](file:///g:/Otros%20ordenadores/Oficina%20Gerenciemos/Gerenciemos%20local/CRM%20con%20Whatpp/database.sql). En especial, la tabla `messages` debe tener esta estructura:
```sql
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(100) PRIMARY KEY,
    jid VARCHAR(150) NOT NULL,
    from_me BOOLEAN NOT NULL DEFAULT FALSE,
    sender_name VARCHAR(255),
    body TEXT,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages (jid);
CREATE INDEX IF NOT EXISTS idx_messages_ts  ON messages (timestamp DESC);
```

### Compilación y Subida del Frontend
Debido a que el proyecto está en una carpeta sincronizada con Google Drive, la instalación de dependencias local con `npm install` puede fallar por bloqueos de archivos.
* **Solución alternativa de build**: Copiar la carpeta `frontend` (excluyendo `node_modules` y `dist`) a una ubicación temporal local (ej: `C:\Users\corda\sanson_temp`), ejecutar `npm install` y `npm run build` allí, y copiar la carpeta `dist` resultante de regreso al espacio de trabajo.
* **Subida manual**: Una vez compilado, se deben subir los archivos de `frontend/dist/` (`index.html`, `.htaccess` y la carpeta `assets/`) mediante un cliente FTP (como FileZilla) al directorio remoto `/sanson.gerenciemosriesgo.com/public_html/`.

---

*Fecha de registro: 16 de Junio de 2026*
*Autor: Antigravity AI (Pair Programming con Edgar Caballero)*
