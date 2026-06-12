import { useState, useRef } from 'react';
import { api } from '../api.js';

// Markdown ligero → HTML (sin dependencias)
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return `<p>${html}</p>`
    .replace(/<p><\/p>/g, '')
    .replace(/<p>(<h[234]>)/g, '$1')
    .replace(/(<\/h[234]>)<\/p>/g, '$1')
    .replace(/<p>(<pre>)/g, '$1')
    .replace(/(<\/pre>)<\/p>/g, '$1')
    .replace(/<p>(<ul>)/g, '$1')
    .replace(/(<\/ul>)<\/p>/g, '$1')
    .replace(/<p>(<hr\/>)/g, '$1')
    .replace(/(<hr\/>)<\/p>/g, '$1');
}

// Estados del asistente
const STATE_SLEEPING = 'sleeping';
const STATE_THINKING = 'thinking';
const STATE_PREPARING = 'preparing';
const STATE_ANSWERING = 'answering';

export default function ChatWidget() {
  const [state, setState] = useState(STATE_SLEEPING);
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const dismissTimer = useRef(null);

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || state === STATE_THINKING || state === STATE_PREPARING) return;

    setInput('');
    setReply('');
    setError('');
    setState(STATE_THINKING);

    // Simular transición a "preparando" después de 5s (cuando el modelo deja de razonar)
    const prepTimer = setTimeout(() => {
      setState(STATE_PREPARING);
    }, 5000);

    try {
      const res = await api.aiChat(text);
      clearTimeout(prepTimer);
      if (res.error) {
        setError(res.error);
        setState(STATE_SLEEPING);
      } else {
        setReply(res.reply);
        setState(STATE_ANSWERING);
        // Auto-dormir después de 30 segundos
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => {
          setReply('');
          setState(STATE_SLEEPING);
        }, 30000);
      }
    } catch (err) {
      clearTimeout(prepTimer);
      setError(err.message);
      setState(STATE_SLEEPING);
    }
  };

  const dismiss = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setReply('');
    setError('');
    setState(STATE_SLEEPING);
  };

  const getCharacterEmoji = () => {
    switch (state) {
      case STATE_SLEEPING: return '😴';
      case STATE_THINKING: return '🤔';
      case STATE_PREPARING: return '✍️';
      case STATE_ANSWERING: return '🤖';
      default: return '😴';
    }
  };

  const getStatusText = () => {
    switch (state) {
      case STATE_THINKING: return 'Pensando...';
      case STATE_PREPARING: return 'Preparándote la respuesta...';
      default: return null;
    }
  };

  const isProcessing = state === STATE_THINKING || state === STATE_PREPARING;

  return (
    <div className="chat-assistant">
      {/* Bocadillo de estado o respuesta */}
      {state !== STATE_SLEEPING && (
        <div className="chat-bubble-container">
          {isProcessing && (
            <div className="chat-bubble chat-bubble-status">
              <span className="chat-status-text">{getStatusText()}</span>
              <span className="chat-typing-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          )}
          {state === STATE_ANSWERING && reply && (
            <div className="chat-bubble chat-bubble-reply">
              <button className="chat-bubble-close" onClick={dismiss} title="Cerrar">✕</button>
              <div className="chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(reply) }} />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="chat-bubble-container">
          <div className="chat-bubble chat-bubble-error">
            <span>⚠️ {error}</span>
            <button className="chat-bubble-close" onClick={dismiss}>✕</button>
          </div>
        </div>
      )}

      {/* Personaje animado */}
      <div className={`chat-character ${state}`} title={state === STATE_SLEEPING ? 'Pregúntame algo' : ''}>
        <span className="chat-character-emoji">{getCharacterEmoji()}</span>
      </div>

      {/* Input */}
      <form className="chat-input-bar chat-input-compact" onSubmit={sendMessage}>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          placeholder={state === STATE_SLEEPING ? '💬 Pregúntame algo...' : 'Esperando...'}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={isProcessing}
        />
        <button type="submit" className="chat-send-btn" disabled={!input.trim() || isProcessing}>
          ➤
        </button>
      </form>
    </div>
  );
}
