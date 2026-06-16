import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

// Normaliza un JID eliminando el sufijo de dispositivo multi-device.
// Ej: "573001234567:3@s.whatsapp.net" → "573001234567@s.whatsapp.net"
const normalizeJid = (jid = '') => {
  if (!jid) return jid;
  const [user, server] = jid.split('@');
  return `${user.split(':')[0]}@${server || 's.whatsapp.net'}`;
};

// Extrae el número de teléfono limpio a partir de un JID de WhatsApp.
const extractPhone = (jid = '') => jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

// Formatea la hora o fecha del último mensaje
const formatTimestamp = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
};

export default function ChatWindow() {
  // Lista de conversaciones agrupadas por JID (derivada dinámicamente de los mensajes)
  const [conversations, setConversations] = useState([]);
  const [activeJid, setActiveJid] = useState(null);
  const [messages, setMessages] = useState([]);
  const [allMessages, setAllMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [searchTemplate, setSearchTemplate] = useState('');
  const [searchContact, setSearchContact] = useState('');
  const [loadingSend, setLoadingSend] = useState(false);
  const [waStatus, setWaStatus] = useState('LOADING');
  const [loading, setLoading] = useState(true);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Agrupa mensajes en conversaciones por JID remoto
  const buildConversations = useCallback((msgs) => {
    const map = {};
    for (const msg of msgs) {
      // El JID de la conversación es el remoto (from) cuando es entrante,
      // o el destinatario (from) cuando es saliente (fromMe)
      const jid = msg.from;
      if (!jid || jid.includes('status@broadcast') || jid.includes('@g.us')) continue;

      if (!map[jid]) {
        map[jid] = {
          jid,
          phone: extractPhone(jid),
          name: msg.name && !msg.fromMe ? msg.name : null,
          lastMessage: msg.text,
          lastTimestamp: msg.timestamp,
          unread: 0,
        };
      } else {
        // Actualizar si este mensaje es más reciente
        if (msg.timestamp > map[jid].lastTimestamp) {
          map[jid].lastMessage = msg.text;
          map[jid].lastTimestamp = msg.timestamp;
        }
        // Guardar nombre del contacto si vino del remoto
        if (msg.name && !msg.fromMe && !map[jid].name) {
          map[jid].name = msg.name;
        }
      }
    }
    // Ordenar por mensaje más reciente
    return Object.values(map).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }, []);

  // Carga los mensajes de la lista de conversaciones (sin filtro por JID)
  const fetchAllMessages = useCallback(async () => {
    try {
      const res = await api.get('/api/whatsapp/messages');
      if (res.ok) {
        const data = await res.json();
        setAllMessages(data);
        setConversations(buildConversations(data));
        setLoading(false);
      }
    } catch (err) {
      console.error('Error al cargar mensajes:', err);
      setLoading(false);
    }
  }, [buildConversations]);

  // Carga los mensajes de la conversación activa filtrando por JID en el backend
  const fetchMessagesForJid = useCallback(async (jid) => {
    if (!jid) return;
    try {
      const res = await api.get(`/api/whatsapp/messages?jid=${encodeURIComponent(normalizeJid(jid))}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error('Error al cargar mensajes del chat:', err);
    }
  }, []);

  // Mantener compatibilidad: filtra mensajes locales usando JIDs normalizados
  const updateActiveMessages = useCallback((jid, msgs) => {
    if (!jid || msgs.length === 0) return;
    const normJid = normalizeJid(jid);
    const phone = extractPhone(jid);
    const filtered = msgs.filter(
      (m) => m.from && (
        normalizeJid(m.from) === normJid ||
        extractPhone(m.from) === phone
      )
    );
    if (filtered.length > 0) setMessages(filtered);
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await api.get('/api/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Error al cargar plantillas:', err);
    }
  };

  const fetchWaStatus = async () => {
    try {
      const res = await api.get('/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        setWaStatus(data.status);
      }
    } catch (err) {}
  };

  // Carga inicial
  useEffect(() => {
    fetchTemplates();
    fetchWaStatus();
    fetchAllMessages();

    // Polling cada 4 segundos para refrescar lista de conversaciones y estado
    const interval = setInterval(() => {
      fetchAllMessages();
      fetchWaStatus();
    }, 4000);

    return () => clearInterval(interval);
  }, [fetchAllMessages]);

  // Cuando cambia el JID activo: cargar mensajes desde el backend con filtro
  useEffect(() => {
    if (activeJid) {
      fetchMessagesForJid(activeJid);
    }
  }, [activeJid, fetchMessagesForJid]);

  // Cuando llegan mensajes nuevos (poll), actualizar el chat activo si hay uno abierto
  useEffect(() => {
    if (activeJid && allMessages.length > 0) {
      updateActiveMessages(activeJid, allMessages);
    }
  }, [allMessages, activeJid, updateActiveMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSelectConversation = (jid) => {
    // No limpiar mensajes aquí: evita el flash de "sin mensajes"
    // Los mensajes se cargarán en el useEffect que observa activeJid
    setActiveJid(jid);
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!inputMsg.trim() || !activeJid || loadingSend) return;

    setLoadingSend(true);
    try {
      const res = await api.post('/api/whatsapp/send', {
        jid: activeJid,
        text: inputMsg,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo enviar el mensaje.');
      }

      setInputMsg('');
      // Pequeño delay para que el backend lo registre antes de recargar
      setTimeout(() => fetchAllMessages(), 600);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoadingSend(false);
    }
  };

  const handleInjectTemplate = (content) => {
    setInputMsg(content);
  };

  // Conversación activa (objeto completo)
  const activeConv = conversations.find((c) => c.jid === activeJid);

  // Filtrar plantillas por búsqueda
  const filteredTemplates = templates.filter(
    (t) =>
      t.title.toLowerCase().includes(searchTemplate.toLowerCase()) ||
      t.category.toLowerCase().includes(searchTemplate.toLowerCase())
  );

  // Filtrar conversaciones por búsqueda
  const filteredConversations = conversations.filter((c) => {
    const term = searchContact.toLowerCase();
    return (
      (c.name || '').toLowerCase().includes(term) ||
      c.phone.includes(term)
    );
  });

  // Badge de estado de WhatsApp
  const statusBadge = {
    CONNECTED: { label: 'Conectado', color: 'bg-emerald-500' },
    QR_READY: { label: 'Esperando QR', color: 'bg-amber-400' },
    CONNECTING: { label: 'Conectando', color: 'bg-blue-400 animate-pulse' },
    DISCONNECTED: { label: 'Desconectado', color: 'bg-rose-500' },
    LOADING: { label: '...', color: 'bg-slate-500' },
  }[waStatus] || { label: waStatus, color: 'bg-slate-500' };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden">

      {/* ── 1. BARRA LATERAL IZQUIERDA: CONVERSACIONES ── */}
      <aside className="w-80 border-r border-slate-800 bg-slate-900/40 flex flex-col">

        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/70 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                💬 Chats
                <span className="text-[10px] bg-indigo-950 text-indigo-400 border border-indigo-900/40 px-2 py-0.5 rounded-full font-semibold">
                  CRM
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {/* Indicador de estado de WhatsApp */}
              <span
                className={`h-2.5 w-2.5 rounded-full ${statusBadge.color}`}
                title={statusBadge.label}
              />
              <span className="text-[10px] text-slate-400">{statusBadge.label}</span>
              <Link
                to="/dashboard"
                className="ml-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold rounded-lg border border-slate-700/60 transition flex items-center gap-1"
                title="Volver al Panel"
              >
                ⚙️ Panel
              </Link>
            </div>
          </div>

          {/* Buscador de contactos */}
          <input
            type="text"
            className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-indigo-500 text-xs text-white placeholder-slate-500"
            placeholder="Buscar conversación..."
            value={searchContact}
            onChange={(e) => setSearchContact(e.target.value)}
          />
        </div>

        {/* Lista de conversaciones */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs gap-2">
              <span className="text-2xl animate-pulse">⏳</span>
              Cargando conversaciones...
            </div>
          ) : waStatus !== 'CONNECTED' ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs gap-3 p-6 text-center">
              <span className="text-4xl">📡</span>
              <p className="font-semibold text-slate-400">WhatsApp no está conectado</p>
              <p>Ve al <Link to="/dashboard" className="text-indigo-400 underline">Panel de Admin</Link> y escanea el código QR para vincular tu cuenta.</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-xs gap-3 p-6 text-center">
              <span className="text-4xl">📭</span>
              <p className="font-semibold text-slate-400">Sin mensajes aún</p>
              <p>Los chats aparecerán aquí en cuanto recibas o envíes mensajes desde tu WhatsApp vinculado.</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredConversations.map((conv) => (
                <button
                  key={conv.jid}
                  onClick={() => handleSelectConversation(conv.jid)}
                  className={`w-full text-left p-3 rounded-xl transition duration-150 border flex items-center gap-3 ${
                    activeJid === conv.jid
                      ? 'bg-indigo-950/50 border-indigo-800/70 text-white'
                      : 'bg-slate-900/40 hover:bg-slate-800/40 border-transparent hover:border-slate-800 text-slate-300'
                  }`}
                >
                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-base font-bold ${
                    activeJid === conv.jid ? 'bg-indigo-700 text-white' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {(conv.name || conv.phone)?.[0]?.toUpperCase() || '?'}
                  </div>

                  {/* Info del chat */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <span className="font-semibold text-sm truncate block">
                        {conv.name || `+${conv.phone}`}
                      </span>
                      <span className="text-[10px] text-slate-500 flex-shrink-0 ml-1">
                        {formatTimestamp(conv.lastTimestamp)}
                      </span>
                    </div>
                    {conv.name && (
                      <span className="text-[10px] text-slate-500 block">+{conv.phone}</span>
                    )}
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {conv.lastMessage || '...'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── 2. SECCIÓN CENTRAL: VENTANA DE CONVERSACIÓN ── */}
      <main className="flex-1 flex flex-col bg-slate-950 relative">
        {activeConv ? (
          <>
            {/* Header del chat activo */}
            <header className="p-4 border-b border-slate-800 bg-slate-900/30 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  {(activeConv.name || activeConv.phone)?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">
                    {activeConv.name || `+${activeConv.phone}`}
                  </h3>
                  <span className="text-[11px] text-slate-400">+{activeConv.phone}</span>
                </div>
              </div>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-950/30 animate-pulse" />
            </header>

            {/* Burbujas de mensajes */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-950/90">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center flex-col text-slate-500">
                  <span className="text-4xl mb-3">✉️</span>
                  <p className="text-sm">No hay mensajes en esta conversación.</p>
                  <p className="text-xs text-slate-600 mt-1">Escribe un mensaje para iniciar el contacto.</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-sm rounded-2xl p-3.5 shadow-sm text-sm border ${
                        msg.fromMe
                          ? 'bg-indigo-600 text-white rounded-br-none border-indigo-500/30'
                          : 'bg-slate-900 text-slate-200 rounded-bl-none border-slate-800/80'
                      }`}
                    >
                      <p className="leading-relaxed break-words whitespace-pre-wrap">{msg.text}</p>
                      <span className={`text-[9px] block text-right mt-1.5 ${msg.fromMe ? 'text-indigo-200' : 'text-slate-500'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input de mensaje */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900/30 flex gap-3">
              <input
                type="text"
                className="flex-1 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-white placeholder-slate-500"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Escribe un mensaje o usa una plantilla de la derecha..."
                disabled={loadingSend}
              />
              <button
                type="submit"
                className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold rounded-xl text-sm transition"
                disabled={loadingSend || !inputMsg.trim()}
              >
                {loadingSend ? 'Enviando...' : '➤ Enviar'}
              </button>
            </form>
          </>
        ) : (
          /* Estado vacío: ningún chat seleccionado */
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4">
            <span className="text-7xl">💬</span>
            <div className="text-center">
              <h3 className="text-lg font-bold text-white">Bandeja de Entrada</h3>
              <p className="text-sm mt-1 text-slate-400">
                {waStatus === 'CONNECTED'
                  ? 'Selecciona una conversación de la izquierda para comenzar.'
                  : 'Conecta WhatsApp desde el Panel de Admin para ver tus mensajes.'}
              </p>
            </div>
            {waStatus !== 'CONNECTED' && (
              <Link
                to="/dashboard"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition"
              >
                Ir al Panel de Conexión →
              </Link>
            )}
          </div>
        )}
      </main>

      {/* ── 3. BARRA DERECHA: RESPUESTAS RÁPIDAS (PLANTILLAS) ── */}
      <aside className="w-72 border-l border-slate-800 bg-slate-900/40 flex flex-col">
        <div className="p-4 border-b border-slate-800 bg-slate-900/60">
          <h3 className="text-sm font-bold text-white">Respuestas Rápidas</h3>
          <p className="text-slate-400 text-[11px] mt-0.5">Haz clic para insertar al cuadro de texto</p>
          <input
            type="text"
            className="w-full mt-3 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-indigo-500 text-xs text-white placeholder-slate-500"
            placeholder="Buscar plantilla..."
            value={searchTemplate}
            onChange={(e) => setSearchTemplate(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredTemplates.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-600">No se encontraron plantillas.</div>
          ) : (
            filteredTemplates.map((template) => (
              <div
                key={template.id}
                onClick={() => handleInjectTemplate(template.content)}
                className="group p-3 rounded-xl bg-slate-900/60 hover:bg-indigo-950/30 border border-slate-800/60 hover:border-indigo-800/50 cursor-pointer transition duration-150 flex flex-col"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="font-semibold text-xs text-white group-hover:text-indigo-300 transition truncate mr-2">
                    {template.title}
                  </span>
                  <span className="text-[9px] bg-slate-950 text-slate-400 px-1.5 py-0.5 rounded border border-slate-800 flex-shrink-0">
                    {template.category}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {template.content}
                </p>
              </div>
            ))
          )}
        </div>
      </aside>

    </div>
  );
}
