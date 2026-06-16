-- database.sql
-- Esquema de base de datos para SanSon (CRM + WhatsApp Web)
-- Optimizado para PostgreSQL en Supabase

-- Habilitar extensión pgcrypto para UUIDs si es necesario (opcional)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- Contraseña hasheada (bcrypt)
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'responsable')) DEFAULT 'responsable',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Plantillas de WhatsApp (Mensajes Frecuentes)
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    category VARCHAR(100) NOT NULL,
    content TEXT NOT NULL, -- Mensaje con emojis
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Persistencia de Sesión de Baileys
-- Permite almacenar credenciales y claves de cifrado en la base de datos
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    session_id VARCHAR(100) NOT NULL,
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL, -- Datos JSON serializados
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, key)
);

-- Índices para optimizar las consultas de sesión de Baileys
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_lookup ON whatsapp_sessions (session_id, key);

-- Tabla de Mensajes de WhatsApp (Historial Persistente)
-- Guarda todos los mensajes enviados y recibidos en la DB para sobrevivir reinicios del servidor
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(100) PRIMARY KEY,                          -- Key ID único de Baileys
    jid VARCHAR(150) NOT NULL,                            -- JID del contacto remoto (normalizado, sin sufijo :deviceId)
    from_me BOOLEAN NOT NULL DEFAULT FALSE,               -- TRUE si fue enviado por nosotros
    sender_name VARCHAR(255),                             -- Nombre push del contacto
    body TEXT,                                            -- Cuerpo del mensaje de texto
    timestamp BIGINT NOT NULL,                            -- Timestamp en milisegundos
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices para consultas rápidas por contacto y orden cronológico
CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages (jid);
CREATE INDEX IF NOT EXISTS idx_messages_ts  ON messages (timestamp DESC);

-- Inserción de un usuario administrador por defecto para la primera entrada
-- Nota: La contraseña está hasheada con bcrypt (coste 10), es 'sansonAdmin123'
INSERT INTO users (username, password, role)
VALUES ('admin', '$2b$10$Y1yZlH.R4bO4tDk9k0e81uvlM1i8V8qjY.oQYjOqVeq6mE4tLw6l2', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Plantillas de ejemplo iniciales
INSERT INTO whatsapp_templates (title, category, content) VALUES
('Bienvenida', 'General', '¡Hola! 👋 Gracias por comunicarte con SanSon. ¿En qué podemos ayudarte el día de hoy? 😊'),
('Cierre de Caso', 'Soporte', 'Estimado cliente, su solicitud ha sido atendida. ✅ Si tiene alguna otra duda, estamos a su servicio.'),
('Recordatorio Pago', 'Cobranza', 'Hola, le recordamos que su fecha límite de pago es pronto. 🗓️ Evite recargos realizando su abono a tiempo.')
ON CONFLICT DO NOTHING;
