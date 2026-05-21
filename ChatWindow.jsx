import React, { useState, useEffect, useRef } from 'react';

export default function ChatWindow() {
  const [contacts, setContacts] = useState([
    { jid: '573001234567', name: 'Juan Pérez (Ejemplo)', status: 'Interesado en Plan' },
    { jid: '573119876543', name: 'María Gómez (Ejemplo)', status: 'Pendiente de Pago' },
    { jid: '573224567890', name: 'Carlos Ruiz (Ejemplo)', status: 'Soporte Técnico' }
  ]);
  const [activeContact, setActiveContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [searchTemplate, setSearchTemplate] = useState('');
  const [loadingSend, setLoadingSend] = useState(false);
  
  const messagesEndRef = useRef(null);
  const token = localStorage.getItem('sanson_token');

  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  });

  // Autodesplazamiento al fondo del chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    fetchTemplates();
    if (activeContact) {
      fetchMessages();
    }
    // Polling ligero cada 4 segundos para actualización en tiempo real sin consumir RAM excesiva
    const interval = setInterval(() => {
      if (activeContact) {
        fetchMessages();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [activeContact]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates', { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Error al cargar plantillas:', err);
    }
  };

  const fetchMessages = async () => {
    try {
      const res = await fetch('/api/whatsapp/messages', { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        // Filtrar mensajes pertenecientes al chat/contacto activo
        const filtered = data.filter(
          (m) => m.from.includes(activeContact.jid)
        );
        setMessages(filtered);
      }
    } catch (err) {
      console.error('Error al cargar mensajes:', err);
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!inputMsg.trim() || !activeContact || loadingSend) return;

    setLoadingSend(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          jid: activeContact.jid,
          text: inputMsg
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'No se pudo enviar el mensaje.');
      }

      setInputMsg('');
      fetchMessages();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoadingSend(false);
    }
  };

  // Inyectar plantilla en el input de texto del chat
  const handleInjectTemplate = (content) => {
    setInputMsg(content);
  };

  // Filtrar plantillas según búsqueda
  const filteredTemplates = templates.filter(
    (t) =>
      t.title.toLowerCase().includes(searchTemplate.toLowerCase()) ||
      t.category.toLowerCase().includes(searchTemplate.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden">
      
      {/* 1. SECCIÓN IZQUIERDA: LISTA DE CONTACTOS */}
      <aside className="w-80 border-r border-slate-800 bg-slate-900/40 flex flex-col">
        <div className="p-5 border-b border-slate-800 bg-slate-900/60">
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            💬 Chats <span className="text-xs bg-indigo-950 text-indigo-400 border border-indigo-900/40 px-2 py-0.5 rounded-full font-semibold">CRM</span>
          </h2>
          <p className="text-slate-400 text-xs mt-1">Contactos registrados en tu campaña</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {contacts.map((contact) => (
            <button
              key={contact.jid}
              onClick={() => {
                setActiveContact(contact);
                setMessages([]);
              }}
              className={`w-full text-left p-3.5 rounded-xl transition duration-200 border flex flex-col ${
                activeContact?.jid === contact.jid
                  ? 'bg-indigo-950/40 border-indigo-800 text-white'
                  : 'bg-slate-900/50 hover:bg-slate-800/40 border-slate-800/50 text-slate-300'
              }`}
            >
              <span className="font-semibold text-sm block">{contact.name}</span>
              <span className="text-xs text-slate-400 mt-1 block">+{contact.jid}</span>
              <span className={`text-[10px] mt-2 inline-block px-2 py-0.5 rounded-full font-medium ${
                activeContact?.jid === contact.jid ? 'bg-indigo-900/50 text-indigo-300' : 'bg-slate-850 text-slate-400'
              }`}>
                {contact.status}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* 2. SECCIÓN CENTRAL: VENTANA DE CONVERSACIÓN */}
      <main className="flex-1 flex flex-col bg-slate-950 relative">
        {activeContact ? (
          <>
            {/* Header del Chat */}
            <header className="p-4 border-b border-slate-800 bg-slate-900/20 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-white text-base">{activeContact.name}</h3>
                <span className="text-xs text-slate-400">Canal de comunicación directo (+{activeContact.jid})</span>
              </div>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-950/30 animate-pulse"></span>
            </header>

            {/* Burbujas del Historial */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-950/90">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center flex-col text-slate-500">
                  <span className="text-5xl mb-3">✉️</span>
                  <p className="text-sm">No hay mensajes recientes en esta conversación.</p>
                  <p className="text-xs text-slate-600 mt-1">Escribe un mensaje para iniciar el contacto.</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-md rounded-2xl p-4 shadow-sm text-sm border ${
                        msg.fromMe
                          ? 'bg-indigo-600 text-white rounded-br-none border-indigo-500/30'
                          : 'bg-slate-900 text-slate-200 rounded-bl-none border-slate-800/80'
                      }`}
                    >
                      <p className="leading-relaxed break-words whitespace-pre-wrap">{msg.text}</p>
                      <span className={`text-[9px] block text-right mt-1.5 ${msg.fromMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input para Escribir y Enviar */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900/30 flex gap-3">
              <input
                type="text"
                className="flex-1 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-white placeholder-slate-500"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Escribe un mensaje o haz clic en una plantilla de respuesta..."
                disabled={loadingSend}
              />
              <button
                type="submit"
                className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold rounded-xl text-sm transition"
                disabled={loadingSend || !inputMsg.trim()}
              >
                {loadingSend ? 'Enviando...' : 'Enviar'}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <span className="text-6xl mb-4">💬</span>
            <h3 className="text-lg font-bold text-white">Bandeja de Entrada</h3>
            <p className="text-sm mt-1 text-slate-400">Selecciona un contacto de la barra izquierda para comenzar.</p>
          </div>
        )}
      </main>

      {/* 3. SECCIÓN DERECHA: RESPUESTAS RÁPIDAS (PLANTILLAS) */}
      <aside className="w-80 border-l border-slate-800 bg-slate-900/40 flex flex-col">
        <div className="p-5 border-b border-slate-800 bg-slate-900/60">
          <h3 className="text-base font-bold text-white">Respuestas Rápidas</h3>
          <p className="text-slate-400 text-xs mt-1">Haz clic para inyectar al cuadro de texto</p>
          
          <input
            type="text"
            className="w-full mt-3 px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-indigo-500 text-xs text-white"
            placeholder="Buscar plantilla..."
            value={searchTemplate}
            onChange={(e) => setSearchTemplate(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredTemplates.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-600">No se encontraron plantillas.</div>
          ) : (
            filteredTemplates.map((template) => (
              <div
                key={template.id}
                onClick={() => handleInjectTemplate(template.content)}
                className="group p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/40 border border-slate-800/60 hover:border-slate-700 cursor-pointer transition duration-150 flex flex-col"
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-xs text-white group-hover:text-indigo-400 transition">{template.title}</span>
                  <span className="text-[9px] bg-slate-950 text-slate-400 px-2 py-0.5 rounded border border-slate-800">{template.category}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-2 line-clamp-3 leading-relaxed">{template.content}</p>
              </div>
            ))
          )}
        </div>
      </aside>
      
    </div>
  );
}
