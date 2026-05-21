// index.js
// Servidor principal Express de SanSon (CRM + WhatsApp Web)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const authMiddleware = require('./authMiddleware');
const whatsappService = require('./whatsappService');
const createTemplateRoutes = require('./templateRoutes');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuración de base de datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido para conexiones externas a Supabase
  }
});

// Middlewares globales
app.use(cors());
app.use(express.json());

// Inicialización asíncrona del servicio de WhatsApp
whatsappService.initializeWhatsApp(pool);

// ==========================================
// RUTA DE AUTENTICACIÓN (LOGIN)
// ==========================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  try {
    // Buscar usuario en la base de datos
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = userRes.rows[0];

    // Verificar contraseña hasheada
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar token JWT sin estado
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      authMiddleware.JWT_SECRET,
      { expiresIn: '7d' } // Expira en 7 días
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (err) {
    console.error('Error durante el login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==========================================
// MONTAR RUTAS DE PLANTILLAS Y WHATSAPP
// ==========================================
app.use(createTemplateRoutes(pool));

// Manejador de rutas no encontradas (404)
app.use((req, res) => {
  res.status(404).json({ error: 'Recurso no encontrado' });
});

// Iniciar servidor HTTP
app.listen(PORT, () => {
  console.log(`Servidor SanSon corriendo en el puerto ${PORT}`);
});
