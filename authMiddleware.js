// authMiddleware.js
// Middleware de autenticación JWT y roles para el CRM SanSon
const jwt = require('jsonwebtoken');

// Clave secreta JWT (debe configurarse en las variables de entorno de Render/Supabase)
const JWT_SECRET = process.env.JWT_SECRET || 'sanson_secret_key_ultra_secure_123!';

/**
 * Middleware para validar el token JWT en las cabeceras HTTP.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Se espera el formato "Bearer <TOKEN>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado.' });
    }
    // Adjuntar datos del usuario decodificados al request
    req.user = decodedUser;
    next();
  });
};

/**
 * Middleware para restringir acceso únicamente al rol 'admin'.
 */
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado. Se requieren privilegios de administrador.' });
  }
  next();
};

/**
 * Middleware genérico para permitir acceso a ciertos roles.
 * @param {string[]} roles - Lista de roles permitidos.
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tiene permisos para realizar esta acción.' });
    }
    next();
  };
};

module.exports = {
  authenticateToken,
  isAdmin,
  authorizeRoles,
  JWT_SECRET
};
