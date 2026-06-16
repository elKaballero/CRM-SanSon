// whatsappService.js
// Servicio de WhatsApp ligero con Baileys y persistencia en PostgreSQL
const { default: makeWASocket, DisconnectReason, BufferJSON, initAuthCreds, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Logger mínimo para ahorrar memoria y procesamiento en Render
const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED

// Pool de DB inyectado al inicializar, usado por sendMessage
let _pool = null;

/**
 * Normaliza un JID de WhatsApp eliminando el sufijo de dispositivo multi-device.
 * Ej: "573001234567:3@s.whatsapp.net" → "573001234567@s.whatsapp.net"
 * Ej: "573001234567@s.whatsapp.net"   → "573001234567@s.whatsapp.net" (sin cambio)
 */
const normalizeJid = (jid = '') => {
  if (!jid) return jid;
  const [user, server] = jid.split('@');
  const cleanUser = user.split(':')[0];
  return `${cleanUser}@${server || 's.whatsapp.net'}`;
};

/**
 * Guarda un mensaje en PostgreSQL. Usa ON CONFLICT DO NOTHING para ignorar duplicados.
 */
const persistMessage = async (pool, { id, jid, fromMe, senderName, body, timestamp }) => {
  try {
    await pool.query(
      `INSERT INTO messages (id, jid, from_me, sender_name, body, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, normalizeJid(jid), fromMe, senderName || null, body || null, timestamp]
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

    // Gestión de mensajes recibidos — persiste en PostgreSQL
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.message) continue;

          const from = msg.key.remoteJid;
          const fromMe = msg.key.fromMe;

          // Ignorar mensajes de estado y grupos
          if (!from || from.includes('status@broadcast') || from.includes('@g.us')) continue;

          // Descomprimir mensaje si es efímero o de visualización única
          let messageContent = msg.message;
          if (messageContent.ephemeralMessage) {
            messageContent = messageContent.ephemeralMessage.message;
          }
          if (messageContent.viewOnceMessage) {
            messageContent = messageContent.viewOnceMessage.message;
          }
          if (messageContent.viewOnceMessageV2) {
            messageContent = messageContent.viewOnceMessageV2.message;
          }

          if (!messageContent) continue;

          const body =
            messageContent.conversation ||
            messageContent.extendedTextMessage?.text ||
            messageContent.imageMessage?.caption ||
            messageContent.videoMessage?.caption ||
            '[Mensaje multimedia]';

          const senderName = fromMe ? 'Tú' : (msg.pushName || null);
          const timestamp = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;

          // Persistir en PostgreSQL (fuente de verdad)
          await persistMessage(pool, {
            id: msg.key.id,
            jid: from,
            fromMe,
            senderName,
            body,
            timestamp,
          });
        }
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
  
  // Formatear número de teléfono (JID)
  let formattedJid = jid;
  if (jid.endsWith('@g.us')) {
    // Si es un chat grupal, lo dejamos igual
  } else {
    // Sanitizar: quitar el sufijo de dispositivo y cualquier carácter no numérico
    const cleanNumber = jid.replace(/@s\.whatsapp\.net$/, '').split(':')[0].replace(/\D/g, '');
    formattedJid = `${cleanNumber}@s.whatsapp.net`;
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
