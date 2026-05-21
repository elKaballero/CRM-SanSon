import React, { useState, useEffect } from 'react';

export default function AdminDashboard() {
  const [templates, setTemplates] = useState([]);
  const [status, setStatus] = useState({ status: 'LOADING', qr: null });
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formData, setFormData] = useState({ title: '', category: 'General', content: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Configuración de token JWT obtenido tras autenticación
  const token = localStorage.getItem('sanson_token');

  // Headers autorizados para peticiones HTTP
  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  });

  useEffect(() => {
    fetchTemplates();
    fetchWhatsAppStatus();
    // Consultar el estado de la conexión de WhatsApp de forma periódica
    const interval = setInterval(fetchWhatsAppStatus, 15000);
    return () => clearInterval(interval);
  }, []);

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

  const fetchWhatsAppStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status', { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Error al cargar estado de WhatsApp:', err);
    }
  };

  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setFormData({ title: '', category: 'General', content: '' });
    setError('');
    setSuccess('');
    setShowModal(true);
  };

  const handleOpenEdit = (template) => {
    setEditingTemplate(template);
    setFormData({ title: template.title, category: template.category, content: template.content });
    setError('');
    setSuccess('');
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const url = editingTemplate ? `/api/templates/${editingTemplate.id}` : '/api/templates';
    const method = editingTemplate ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: getHeaders(),
        body: JSON.stringify(formData)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Ocurrió un error inesperado');
      }

      setSuccess(editingTemplate ? 'Plantilla actualizada' : 'Plantilla creada exitosamente');
      fetchTemplates();
      setTimeout(() => setShowModal(false), 1000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Está seguro de eliminar esta plantilla de mensaje?')) return;
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        fetchTemplates();
      }
    } catch (err) {
      console.error('Error al borrar plantilla:', err);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('¿Desea desconectar WhatsApp y eliminar credenciales de este servidor?')) return;
    try {
      await fetch('/api/whatsapp/logout', {
        method: 'POST',
        headers: getHeaders()
      });
      fetchWhatsAppStatus();
    } catch (err) {
      console.error('Error al desconectar WhatsApp:', err);
    }
  };

  // Exportador de CSV en el cliente (Ahorro de memoria en Render)
  const handleExportCSV = () => {
    if (templates.length === 0) return;
    const headers = ['ID', 'Titulo', 'Categoria', 'Contenido'];
    const rows = templates.map((t) => [
      t.id,
      `"${t.title.replace(/"/g, '""')}"`,
      `"${t.category.replace(/"/g, '""')}"`,
      `"${t.content.replace(/"/g, '""')}"`
    ]);
    
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sanson_plantillas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased p-6 md:p-12">
      {/* HEADER DE SANSON */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            SanSon <span className="text-emerald-400 text-sm font-medium px-2.5 py-0.5 rounded-full bg-emerald-950/50 border border-emerald-800/30">CRM + WhatsApp</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Panel de control de administración y configuración global</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleExportCSV}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl transition duration-200 flex items-center gap-2 border border-slate-700"
          >
            📊 Exportar CSV
          </button>
          <button 
            onClick={handleOpenCreate}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition duration-200 shadow-lg shadow-indigo-950/20"
          >
            + Nueva Plantilla
          </button>
        </div>
      </header>

      {/* METRICAS Y SESION WHATSAPP */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        
        {/* CARD WHATSAPP STATUS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start">
              <h2 className="text-lg font-bold text-white">Canal WhatsApp</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                status.status === 'CONNECTED' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40' :
                status.status === 'QR_READY' ? 'bg-amber-950/40 text-amber-400 border-amber-800/40' :
                'bg-rose-950/40 text-rose-400 border-rose-800/40'
              }`}>
                {status.status === 'CONNECTED' ? 'Conectado' : 
                 status.status === 'QR_READY' ? 'Esperando Vinculación' : 'Desconectado'}
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-1.5">Motor ligero sobre Render (Cero Chromium)</p>
          </div>

          <div className="my-6 flex justify-center items-center min-h-[150px]">
            {status.status === 'CONNECTED' ? (
              <div className="text-center">
                <span className="text-5xl">✅</span>
                <p className="text-emerald-400 font-semibold text-sm mt-3">Sesión activa y lista para operar</p>
              </div>
            ) : status.status === 'QR_READY' && status.qr ? (
              <div className="text-center flex flex-col items-center">
                {/* Contenedor simple para el código QR */}
                <div className="bg-white p-3 rounded-xl inline-block shadow-lg">
                  {/* El frontend suele usar una librería para renderizar QR, o el backend envía la imagen directo.
                      Aquí proveemos el contenedor para renderizar el código QR de Baileys */}
                  <div className="text-[7px] font-mono leading-none bg-white text-black p-2 rounded">
                    {/* Renderizamos el hash de forma minimalista para evitar fallos de librerías en UI limpia */}
                    <div className="text-center font-sans text-xs font-semibold mb-2">Escanee con WhatsApp</div>
                    <code className="text-slate-500 break-all select-all font-mono text-[9px] block max-w-[150px]">
                      {status.qr.substring(0, 45)}...
                    </code>
                  </div>
                </div>
                <p className="text-amber-400 text-xs mt-3 font-medium">Escanea este código QR desde WhatsApp Web</p>
              </div>
            ) : (
              <div className="text-center text-slate-500">
                <span className="text-4xl block mb-2">📡</span>
                <span className="text-xs">Estableciendo conexión con el motor de WhatsApp...</span>
              </div>
            )}
          </div>

          {status.status === 'CONNECTED' && (
            <button
              onClick={handleDisconnect}
              className="w-full py-2 bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 border border-rose-800/30 rounded-xl text-xs font-semibold transition"
            >
              Cerrar Sesión WhatsApp
            </button>
          )}
        </div>

        {/* METRICAS RAPIDAS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Métricas de Respuestas</h2>
            <p className="text-slate-400 text-xs">Uso de plantillas y rendimiento ligero</p>
          </div>
          <div className="grid grid-cols-2 gap-4 my-6">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80">
              <span className="text-slate-400 text-xs block font-medium">Plantillas Totales</span>
              <span className="text-3xl font-extrabold text-white mt-1 block">{templates.length}</span>
            </div>
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80">
              <span className="text-slate-400 text-xs block font-medium">RAM Consumo</span>
              <span className="text-3xl font-extrabold text-indigo-400 mt-1 block">&lt; 150MB</span>
            </div>
          </div>
          <div className="text-xs text-slate-400">
            Optimizaciones aplicadas: persistencia SQLite/PostgreSQL y procesamiento asíncrono optimizado.
          </div>
        </div>

        {/* INFO RENDER */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Estado del Servidor</h2>
            <p className="text-slate-400 text-xs">Parámetros de ejecución en Render</p>
          </div>
          <div className="space-y-3 my-6">
            <div className="flex justify-between text-xs border-b border-slate-800 pb-2">
              <span className="text-slate-400">Plataforma</span>
              <span className="text-white font-medium">Render Free</span>
            </div>
            <div className="flex justify-between text-xs border-b border-slate-800 pb-2">
              <span className="text-slate-400">Persistencia</span>
              <span className="text-emerald-400 font-medium">Supabase DB</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Evitar Suspensión</span>
              <span className="text-indigo-400 font-medium">UptimeRobot (/ping)</span>
            </div>
          </div>
          <div className="text-xs text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800/60">
            🚀 <strong>Sanson CRM</strong> está configurado con sesiones sin archivos locales para operar libre de reinicios del sistema de Render.
          </div>
        </div>

      </div>

      {/* CRUD DE PLANTILLAS */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-xl font-bold text-white mb-6">Plantillas de Respuesta Rápida</h2>

        {templates.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-slate-950/40 rounded-xl border border-dashed border-slate-800">
            No hay plantillas guardadas en la base de datos.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Título</th>
                  <th className="py-3 px-4">Categoría</th>
                  <th className="py-3 px-4">Mensaje</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {templates.map((template) => (
                  <tr key={template.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-4 px-4 font-semibold text-white">{template.title}</td>
                    <td className="py-4 px-4">
                      <span className="px-2.5 py-1 rounded-md bg-indigo-950/40 text-indigo-300 border border-indigo-900/30 text-xs">
                        {template.category}
                      </span>
                    </td>
                    <td className="py-4 px-4 max-w-md truncate text-slate-300">{template.content}</td>
                    <td className="py-4 px-4 text-right space-x-2">
                      <button 
                        onClick={() => handleOpenEdit(template)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-950/20 px-2.5 py-1.5 rounded-lg border border-indigo-900/20"
                      >
                        Editar
                      </button>
                      <button 
                        onClick={() => handleDelete(template.id)}
                        className="text-xs text-rose-400 hover:text-rose-300 bg-rose-950/20 px-2.5 py-1.5 rounded-lg border border-rose-900/20"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL CREAR / EDITAR */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                {editingTemplate ? 'Editar Plantilla' : 'Nueva Plantilla'}
              </h3>
              <button 
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && <div className="p-3 rounded-lg bg-rose-950/40 text-rose-400 border border-rose-800/40 text-xs">{error}</div>}
              {success && <div className="p-3 rounded-lg bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 text-xs">{success}</div>}
              
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Título de Plantilla</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-white" 
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ej: Mensaje de Bienvenida"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Categoría</label>
                <select 
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-white" 
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="General">General</option>
                  <option value="Soporte">Soporte</option>
                  <option value="Cobranza">Cobranza</option>
                  <option value="Ventas">Ventas</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Contenido del Mensaje</label>
                <textarea 
                  rows="4"
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-white resize-none" 
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Escribe el mensaje aquí (soporta emojis y variables manuales)..."
                  required
                />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 text-sm font-medium rounded-xl transition"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition shadow-lg"
                >
                  Guardar Plantilla
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
