// whatsappService.js
// Servicio de WhatsApp ligero con Baileys y persistencia en PostgreSQL
const { default: makeWASocket, DisconnectReason, BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Logger mínimo para ahorrar memoria y procesamiento en Render
const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, QR_READY, CONNECTED
let recentMessages = []; // Memoria RAM ultraligera para últimos mensajes en tiempo real (límite 100)

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
    connectionStatus = 'CONNECTING';
    const { state, saveCreds } = await useDatabaseAuthState(pool, sessionId);

    sock = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      mobile: false
    });

    // Guardar credenciales al actualizarse
    sock.ev.on('creds.update', saveCreds);

    // Escucha de conexión
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        connectionStatus = 'QR_READY';
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        connectionStatus = 'DISCONNECTED';
        qrCode = null;

        if (shouldReconnect) {
          // Intentar reconectar tras un breve retraso
          setTimeout(() => initializeWhatsApp(pool, sessionId), 5000);
        } else {
          // Si cerró sesión, limpiamos la base de datos de credenciales
          await pool.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [sessionId]);
          setTimeout(() => initializeWhatsApp(pool, sessionId), 2000);
        }
      } else if (connection === 'open') {
        connectionStatus = 'CONNECTED';
        qrCode = null;
      }
    });

    // Gestión de mensajes recibidos (Historial básico en RAM)
    sock.ev.on('messages.upsert', (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            const from = msg.key.remoteJid;
            const name = msg.pushName || 'Contacto de WhatsApp';
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         '[Mensaje no soportado/Multimedia]';
            
            // Añadir al registro de mensajes en RAM con límite de 100 elementos
            recentMessages.push({
              id: msg.key.id,
              from,
              name,
              text,
              timestamp: msg.messageTimestamp * 1000,
              fromMe: false
            });

            if (recentMessages.length > 100) {
              recentMessages.shift();
            }
          }
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
  // Formatear número de teléfono (JID) si viene limpio sin dominio
  const formattedJid = jid.includes('@s.whatsapp.net') ? jid : `${jid}@s.whatsapp.net`;
  
  const result = await sock.sendMessage(formattedJid, { text });
  
  // Guardar mensaje enviado en historial reciente en RAM
  recentMessages.push({
    id: result.key.id,
    from: formattedJid,
    name: 'Tú',
    text,
    timestamp: Date.now(),
    fromMe: true
  });

  if (recentMessages.length > 100) {
    recentMessages.shift();
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
const getRecentMessages = () => recentMessages;
const getSocket = () => sock;

module.exports = {
  initializeWhatsApp,
  sendMessage,
  logoutWhatsApp,
  getQrCode,
  getConnectionStatus,
  getRecentMessages,
  getSocket
};
