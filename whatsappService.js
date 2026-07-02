// whatsappService.js
// Servicio de WhatsApp ligero con Baileys y persistencia en PostgreSQL
const {
  default: makeWASocket,
  DisconnectReason,
  BufferJSON,
  initAuthCreds,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// Logger mínimo para ahorrar memoria y procesamiento en Render
const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED

// Pool de DB inyectado al inicializar, usado por sendMessage
let _pool = null;

/**
 * Normaliza un JID de WhatsApp eliminando SOLO el sufijo de dispositivo multi-device (:N).
 * Preserva el dominio original (@s.whatsapp.net, @lid, @g.us, etc.).
 *
 * - JID estándar: "573001234567:3@s.whatsapp.net" → "573001234567@s.whatsapp.net"
 * - JID @lid:     "46389975335013:0@lid"           → "46389975335013@lid"
 *   (NO se aplica replace(/\D/g,'') para no corromper el identificador opaco)
 */
const normalizeJid = (jid = '') => {
  if (!jid || typeof jid !== 'string') return jid;
  const atIdx = jid.lastIndexOf('@');
  if (atIdx === -1) return jid;                          // sin dominio → devolver tal cual
  const server = jid.slice(atIdx + 1);                  // "s.whatsapp.net" | "lid" | "g.us"
  const rawUser = jid.slice(0, atIdx);                  // puede traer el sufijo :N
  const cleanUser = rawUser.split(':')[0];               // quitar :N
  return `${cleanUser}@${server}`;
};

/**
 * Persiste un mensaje en PostgreSQL.
 * Usa UPSERT (ON CONFLICT DO UPDATE) para:
 *  - No duplicar mensajes ya existentes.
 *  - Actualizar el body/senderName si llegan con más datos (ej. historial inicial).
 */
const persistMessage = async (pool, { id, jid, fromMe, senderName, body, mediaType, timestamp }) => {
  try {
    await pool.query(
      `INSERT INTO messages (id, jid, from_me, sender_name, body, media_type, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET body        = COALESCE(EXCLUDED.body,        messages.body),
             sender_name = COALESCE(EXCLUDED.sender_name, messages.sender_name),
             media_type  = COALESCE(EXCLUDED.media_type,  messages.media_type)`,
      [id, normalizeJid(jid), fromMe, senderName || null, body || null, mediaType || null, timestamp]
    );
  } catch (err) {
    console.error('[WhatsApp] Error al persistir mensaje en DB:', err.message);
  }
};

/**
 * Adaptador de estado de autenticación de Baileys para PostgreSQL.
 * Serializa buffers y claves usando BufferJSON para evitar pérdidas de sesión.
 */
const useDatabaseAuthState = async (pool, sessionId) => {
  const writeData = async (key, value) => {
    const jsonStr = JSON.stringify(value, BufferJSON.replacer);
    await pool.query(
      `INSERT INTO whatsapp_sessions (session_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (session_id, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [sessionId, key, jsonStr]
    );
  };

  const readData = async (key) => {
    const res = await pool.query(
      'SELECT value FROM whatsapp_sessions WHERE session_id = $1 AND key = $2',
      [sessionId, key]
    );
    if (res.rows.length === 0) return null;
    return JSON.parse(res.rows[0].value, BufferJSON.reviver);
  };

  const removeData = async (key) => {
    await pool.query(
      'DELETE FROM whatsapp_sessions WHERE session_id = $1 AND key = $2',
      [sessionId, key]
    );
  };

  // Carga o inicializa credenciales principales
  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData('creds', creds);
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        await Promise.all(
          ids.map(async (id) => {
            const value = await readData(`${type}:${id}`);
            if (value) {
              data[id] = value;
            }
          })
        );
        return data;
      },
      set: async (data) => {
        const tasks = [];
        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            const value = data[type][id];
            const key = `${type}:${id}`;
            if (value) {
              tasks.push(writeData(key, value));
            } else {
              tasks.push(removeData(key));
            }
          }
        }
        await Promise.all(tasks);
      }
    }
  };

  return {
    state,
    saveCreds: async () => {
      await writeData('creds', state.creds);
    }
  };
};

/**
 * Inicialización principal de la conexión con WhatsApp
 */
const initializeWhatsApp = async (pool, sessionId = 'sanson_default_session') => {
  try {
    // Guardar referencia al pool para usarlo en sendMessage
    _pool = pool;

    console.log(`[WhatsApp] Inicializando servicio para sesión: ${sessionId}`);
    connectionStatus = 'CONNECTING';

    // Obtener la última versión de WhatsApp Web de forma dinámica
    let version = [2, 3000, 1017531287]; // Fallback seguro
    try {
      const { version: latestVersion, isLatest } = await fetchLatestBaileysVersion();
      version = latestVersion;
      console.log(`[WhatsApp] Versión obtenida de WA Web: ${version.join('.')}, ¿Es la última?: ${isLatest}`);
    } catch (err) {
      console.warn('[WhatsApp] No se pudo obtener la última versión de WA Web, usando fallback:', err.message);
    }

    const { state, saveCreds } = await useDatabaseAuthState(pool, sessionId);

    sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      mobile: false,
      browser: ['Chrome (Sanson CRM)', 'Windows', '10.0']
    });

    // Guardar credenciales al actualizarse
    sock.ev.on('creds.update', saveCreds);

    // Escucha de conexión
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log(`[WhatsApp] connection.update: connection=${connection || 'n/a'}, qr=${qr ? 'SÍ' : 'NO'}`);

      if (qr) {
        qrCode = qr;
        connectionStatus = 'QR_READY';
        console.log(`[WhatsApp] Código QR generado e interceptado.`);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        connectionStatus = 'DISCONNECTED';
        qrCode = null;
        console.log(`[WhatsApp] Conexión cerrada. ¿Reconectar?: ${shouldReconnect}`, lastDisconnect?.error || '');

        if (shouldReconnect) {
          // Intentar reconectar tras un breve retraso
          setTimeout(() => initializeWhatsApp(pool, sessionId), 5000);
        } else {
          // Si cerró sesión, limpiamos la base de datos de credenciales
          console.log(`[WhatsApp] Sesión expirada o cerrada explícitamente. Limpiando DB...`);
          await pool.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [sessionId]);
          setTimeout(() => initializeWhatsApp(pool, sessionId), 2000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'CONNECTED';
        qrCode = null;
        console.log(`[WhatsApp] ¡Conectado exitosamente!`);
      }
    });

    // ── Procesar un objeto de mensaje de Baileys y persistirlo ──────────────
    const processAndPersistMsg = async (msg) => {
      if (!msg.message && !msg.key) return;  // entrada vacía

      const from   = msg.key.remoteJid;
      const fromMe = !!msg.key.fromMe;

      // Ignorar estado y grupos
      if (!from || from.includes('status@broadcast') || from.includes('@g.us')) return;

      // Descomprimir capas de wrapping (efímero, viewOnce)
      let mc = msg.message || {};
      mc = mc.ephemeralMessage?.message   || mc;
      mc = mc.viewOnceMessage?.message    || mc;
      mc = mc.viewOnceMessageV2?.message  || mc;

      // ── Detectar tipo de media ────────────────────────────────────────────
      const IMAGE_KEY    = mc.imageMessage    ? 'imageMessage'    : null;
      const VIDEO_KEY    = mc.videoMessage    ? 'videoMessage'    : null;
      const DOC_KEY      = mc.documentMessage ? 'documentMessage' : null;
      const AUDIO_KEY    = mc.audioMessage    ? 'audioMessage'    : null;
      const mediaKey     = IMAGE_KEY || VIDEO_KEY || DOC_KEY || AUDIO_KEY;

      let body      = null;
      let mediaType = null;

      if (mediaKey) {
        // Caption de la imagen/vídeo como texto de prevista
        const caption = mc[mediaKey]?.caption || null;
        mediaType = mediaKey.replace('Message', ''); // 'image', 'video', etc.

        try {
          // downloadMediaMessage requiere el objeto msg original completo
          const buffer = await downloadMediaMessage(
            { ...msg, message: mc },       // aseguramos que mc sea el message del nivel correcto
            'buffer',
            {},
            { logger, reuploadRequest: sock.updateMediaMessage }
          );

          if (buffer && buffer.length > 0) {
            const mimeType = mc[mediaKey]?.mimetype || 'application/octet-stream';
            // Guardar como data URI (Base64) — el frontend puede renderizarlo directamente
            // Nota: para archivos grandes (>1 MB) considera guardar en disco/S3 y almacenar la URL.
            const MAX_B64_BYTES = 1.5 * 1024 * 1024; // 1.5 MB límite razonable
            if (buffer.length <= MAX_B64_BYTES) {
              body = `data:${mimeType};base64,${buffer.toString('base64')}`;
            } else {
              // Archivo demasiado grande: guardar caption o indicador con tipo
              body = caption || `[${mediaType}: archivo grande, ${Math.round(buffer.length / 1024)} KB]`;
            }
          } else {
            body = caption || `[${mediaType}]`;
          }
        } catch (dlErr) {
          console.warn(`[WhatsApp] No se pudo descargar media (${mediaKey}):`, dlErr.message);
          body = caption || `[${mediaType}]`;
        }
      } else {
        // Mensaje de texto plano
        body =
          mc.conversation ||
          mc.extendedTextMessage?.text ||
          null;
      }

      // ── Resolver nombre del remitente ─────────────────────────────────────
      let senderName = fromMe ? 'Tú' : (msg.pushName || null);
      if (!fromMe && !senderName && from.endsWith('@lid') && sock.store?.contacts) {
        const contact = sock.store.contacts[normalizeJid(from)];
        senderName = contact?.notify || contact?.name || contact?.verifiedName || null;
      }

      const timestamp = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;

      await persistMessage(pool, { id: msg.key.id, jid: from, fromMe, senderName, body, mediaType, timestamp });
    };

    // ── Evento principal: mensajes nuevos y propios (notify) o historial reciente (append) ──
    sock.ev.on('messages.upsert', async (m) => {
      // 'notify' = mensaje nuevo en tiempo real (entrante Y saliente fromMe:true)
      // 'append'  = historial reciente sincronizado al reconectar
      if (m.type !== 'notify' && m.type !== 'append') return;
      for (const msg of m.messages) {
        await processAndPersistMsg(msg);
      }
    });

    // ── Historial inicial completo enviado por WhatsApp al primer sync ────────
    sock.ev.on('messaging-history.set', async ({ messages: histMsgs, isLatest }) => {
      console.log(`[WhatsApp] messaging-history.set: ${histMsgs.length} mensajes, isLatest=${isLatest}`);
      for (const msg of histMsgs) {
        // El historial puede incluir grupos e items sin key — filtrar aquí
        if (!msg.key?.remoteJid) continue;
        await processAndPersistMsg(msg);
      }
    });

  } catch (error) {
    connectionStatus = 'DISCONNECTED';
    console.error('Error al inicializar Baileys:', error);
  }
};

/**
 * Enviar mensaje de texto simple
 */
const sendMessage = async (jid, text) => {
  if (!sock || connectionStatus !== 'CONNECTED') {
    throw new Error('El servicio de WhatsApp no está conectado actualmente.');
  }
  
  // Formatear JID antes de enviar
  // REGLA: para @lid conservamos el ID tal cual (es opaco, no es número de teléfono).
  //        para @s.whatsapp.net limpiamos el sufijo :N y los no-dígitos del user.
  //        Si no tiene dominio, se asume número individual → @s.whatsapp.net.
  let formattedJid;
  if (jid.endsWith('@g.us')) {
    formattedJid = normalizeJid(jid);                            // grupos: solo quitar :N
  } else if (jid.endsWith('@lid')) {
    formattedJid = normalizeJid(jid);                            // @lid: preservar ID opaco
  } else if (jid.includes('@')) {
    const norm = normalizeJid(jid);                              // quita :N
    const [user, server] = norm.split('@');
    formattedJid = `${user.replace(/\D/g, '')}@${server}`;      // solo s.whatsapp.net: solo dígitos
  } else {
    formattedJid = `${jid.replace(/\D/g, '')}@s.whatsapp.net`;  // número crudo → dominio por defecto
  }
  
  const result = await sock.sendMessage(formattedJid, { text });
  
  // Persistir mensaje enviado en PostgreSQL
  if (_pool && result?.key?.id) {
    await persistMessage(_pool, {
      id: result.key.id,
      jid: formattedJid,
      fromMe: true,
      senderName: 'Tú',
      body: text,
      timestamp: Date.now(),
    });
  }

  return result;
};

/**
 * Desconecta la sesión y borra credenciales de la DB
 */
const logoutWhatsApp = async (pool, sessionId = 'sanson_default_session') => {
  if (sock) {
    try {
      await sock.logout();
    } catch (e) {}
  }
  await pool.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [sessionId]);
  qrCode = null;
  connectionStatus = 'DISCONNECTED';
};

const getQrCode = () => qrCode;
const getConnectionStatus = () => connectionStatus;
const getSocket = () => sock;

module.exports = {
  initializeWhatsApp,
  sendMessage,
  logoutWhatsApp,
  getQrCode,
  getConnectionStatus,
  getSocket,
  normalizeJid,
};
