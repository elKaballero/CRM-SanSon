// templateRoutes.js
// Rutas de Express para CRUD de Plantillas y Gestión de WhatsApp (SanSon)
const express = require('express');
const { authenticateToken, isAdmin } = require('./authMiddleware');
const whatsappService = require('./whatsappService');

module.exports = (pool) => {
  const router = express.Router();

  // ==========================================
  // ENDPOINT DE REACTIVACIÓN (PÚBLICO)
  // ==========================================
  // Usado por UptimeRobot para evitar que Render detenga la instancia gratuita.
  router.get('/ping', (req, res) => {
    return res.status(200).send('pong');
  });

  // Endpoint de debug temporal
  router.get('/api/debug/messages', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50');
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================
  // RUTAS DE PLANTILLAS (CRUD)
  // ==========================================

  // Obtener todas las plantillas (Admin y Responsable)
  router.get('/api/templates', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM whatsapp_templates ORDER BY id DESC');
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al obtener las plantillas' });
    }
  });

  // Crear una nueva plantilla (Solo Admin)
  router.post('/api/templates', authenticateToken, isAdmin, async (req, res) => {
    const { title, category, content } = req.body;
    if (!title || !category || !content) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    try {
      const result = await pool.query(
        'INSERT INTO whatsapp_templates (title, category, content) VALUES ($1, $2, $3) RETURNING *',
        [title, category, content]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al guardar la plantilla' });
    }
  });

  // Actualizar una plantilla (Solo Admin)
  router.put('/api/templates/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, category, content } = req.body;
    if (!title || !category || !content) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    try {
      const result = await pool.query(
        'UPDATE whatsapp_templates SET title = $1, category = $2, content = $3 WHERE id = $4 RETURNING *',
        [title, category, content, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Plantilla no encontrada' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al actualizar la plantilla' });
    }
  });

  // Eliminar una plantilla (Solo Admin)
  router.delete('/api/templates/:id', authenticateToken, isAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      const result = await pool.query('DELETE FROM whatsapp_templates WHERE id = $1 RETURNING *', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Plantilla no encontrada' });
      }
      res.json({ message: 'Plantilla eliminada exitosamente' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al eliminar la plantilla' });
    }
  });

  // ==========================================
  // RUTAS DE CONTROL DE WHATSAPP
  // ==========================================

  // Obtener estado de conexión y código QR de WhatsApp (Admin y Responsable)
  router.get('/api/whatsapp/status', authenticateToken, (req, res) => {
    const status = whatsappService.getConnectionStatus();
    const qr = whatsappService.getQrCode();
    res.json({ status, qr });
  });

  // Obtener historial de mensajes desde PostgreSQL (Admin y Responsable)
  // Soporta filtrado por ?jid=... para cargar solo los mensajes de un contacto
  router.get('/api/whatsapp/messages', authenticateToken, async (req, res) => {
    try {
      const { jid } = req.query;

      let query, params;

      if (jid) {
        // Filtrar por JID normalizado (quita sufijo de dispositivo multi-device)
        const normalizedJid = whatsappService.normalizeJid(jid);
        query = `
          SELECT id, jid, from_me AS "fromMe", sender_name AS name,
                 body AS text, media_type AS "mediaType", timestamp
          FROM messages
          WHERE jid = $1
          ORDER BY timestamp ASC
          LIMIT 300
        `;
        params = [normalizedJid];
      } else {
        // Sin filtro: devuelve los últimos 200 mensajes (para construir lista de conversaciones)
        query = `
          SELECT id, jid AS "from", from_me AS "fromMe", sender_name AS name,
                 body AS text, media_type AS "mediaType", timestamp
          FROM messages
          ORDER BY timestamp DESC
          LIMIT 200
        `;
        params = [];
      }

      const result = await pool.query(query, params);

      // Para la vista de chat individual, mapear "from" al campo esperado por el frontend
      const rows = jid
        ? result.rows.map(r => ({ ...r, from: r.jid }))
        : result.rows;

      res.json(rows);
    } catch (err) {
      console.error('[API] Error al obtener mensajes:', err);
      res.status(500).json({ error: 'Error al obtener mensajes' });
    }
  });

  // Enviar un mensaje de WhatsApp a demanda (Admin y Responsable)
  router.post('/api/whatsapp/send', authenticateToken, async (req, res) => {
    const { jid, text } = req.body;
    if (!jid || !text) {
      return res.status(400).json({ error: 'Número de WhatsApp (jid) y texto son obligatorios' });
    }
    try {
      await whatsappService.sendMessage(jid, text);
      res.json({ success: true, message: 'Mensaje encolado/enviado exitosamente' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Error al enviar el mensaje de WhatsApp' });
    }
  });

  // Cerrar la sesión activa de WhatsApp y purgar credenciales de la DB (Solo Admin)
  router.post('/api/whatsapp/logout', authenticateToken, isAdmin, async (req, res) => {
    try {
      await whatsappService.logoutWhatsApp(pool);
      res.json({ success: true, message: 'Sesión de WhatsApp cerrada y credenciales eliminadas' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error al cerrar sesión de WhatsApp' });
    }
  });

  return router;
};
