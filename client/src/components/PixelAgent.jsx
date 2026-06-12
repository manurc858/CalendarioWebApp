import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';

/*
  Sprite sheet: char_0.png — 112×96px
  7 columns × 3 rows → each frame 16×32px
  Row 0 = front (down)   Row 1 = back (up)   Row 2 = right (left = flip)
  Cols: 0-2 walk  |  3-4 typing  |  5-6 reading
*/

const FRAME_W = 16;
const FRAME_H = 32;
const SCALE = 2; // render at 32×64
const SPRITE_W = FRAME_W * SCALE;
const SPRITE_H = FRAME_H * SCALE;

// States: sleeping, idle, thinking, responding, error
const ANIM_MAP = {
  sleeping: { row: 0, frames: [0], speed: 0 },
  idle:     { row: 0, frames: [0, 1, 0, 2], speed: 600 },
  walking:  { row: 2, frames: [0, 1, 0, 2], speed: 200 },
  thinking: { row: 0, frames: [3, 4], speed: 400 },
  responding: { row: 0, frames: [5, 6], speed: 500 },
  error:    { row: 0, frames: [0], speed: 0 },
};

// Simple markdown → HTML (reused from ChatWidget)
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

export default function PixelAgent() {
  // Position & movement
  const [posX, setPosX] = useState(80);
  const posXRef = useRef(80);
  const [direction, setDirection] = useState(1); // 1=right, -1=left
  const [agentState, setAgentState] = useState('sleeping');
  const agentStateRef = useRef('sleeping');
  const [frameIdx, setFrameIdx] = useState(0);

  // Chat
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const bubbleOpenRef = useRef(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [isPageVisible, setIsPageVisible] = useState(!document.hidden);

  const inputRef = useRef(null);
  const moveTimerRef = useRef(null);
  const idleTimerRef = useRef(null);
  const responseRef = useRef(null);
  const sleepTimerRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { posXRef.current = posX; }, [posX]);
  useEffect(() => { agentStateRef.current = agentState; }, [agentState]);
  useEffect(() => { bubbleOpenRef.current = bubbleOpen; }, [bubbleOpen]);

  useEffect(() => {
    const onVisibilityChange = () => setIsPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Wake up after 3 seconds
  useEffect(() => {
    const t = setTimeout(() => setAgentState('idle'), 3000);
    return () => clearTimeout(t);
  }, []);

  // Go to sleep after 30s of inactivity (idle + bubble closed)
  useEffect(() => {
    clearTimeout(sleepTimerRef.current);
    if (agentState === 'idle' && !bubbleOpen) {
      sleepTimerRef.current = setTimeout(() => {
        clearInterval(moveTimerRef.current);
        clearTimeout(idleTimerRef.current);
        setAgentState('sleeping');
      }, 30000);
    }
    return () => clearTimeout(sleepTimerRef.current);
  }, [agentState, bubbleOpen]);

  // Sprite animation loop
  useEffect(() => {
    if (!isPageVisible) {
      setFrameIdx(0);
      return;
    }

    const anim = ANIM_MAP[agentState];
    if (!anim || anim.speed === 0) {
      setFrameIdx(0);
      return;
    }
    let i = 0;
    const iv = setInterval(() => {
      i = (i + 1) % anim.frames.length;
      setFrameIdx(i);
    }, anim.speed);
    return () => clearInterval(iv);
  }, [agentState, isPageVisible]);

  // Autonomous wandering
  useEffect(() => {
    if (!isPageVisible) {
      clearTimeout(idleTimerRef.current);
      clearInterval(moveTimerRef.current);
      return;
    }

    const scheduleWalk = () => {
      const delay = 4000 + Math.random() * 6000;
      idleTimerRef.current = setTimeout(() => {
        // Only walk if idle and bubble is closed
        if (agentStateRef.current !== 'idle' || bubbleOpenRef.current) {
          scheduleWalk();
          return;
        }
        const maxX = window.innerWidth - SPRITE_W - 20;
        const targetX = 20 + Math.random() * Math.max(0, maxX);
        const startX = posXRef.current;
        setAgentState('walking');
        setDirection(targetX > startX ? 1 : -1);

        const dist = Math.abs(targetX - startX);
        const speed = 1.5;
        const totalSteps = Math.max(1, Math.ceil(dist / speed));
        let step = 0;

        clearInterval(moveTimerRef.current);
        moveTimerRef.current = setInterval(() => {
          step++;
          const newX = startX + (targetX - startX) * (step / totalSteps);
          const rounded = Math.round(newX);
          posXRef.current = rounded;
          setPosX(rounded);
          if (step >= totalSteps) {
            clearInterval(moveTimerRef.current);
            setAgentState('idle');
            scheduleWalk();
          }
        }, 30);
      }, delay);
    };

    scheduleWalk();
    return () => {
      clearTimeout(idleTimerRef.current);
      clearInterval(moveTimerRef.current);
    };
  }, [isPageVisible]);

  // Click handler
  const handleClick = () => {
    // Stop walking
    clearInterval(moveTimerRef.current);
    clearTimeout(idleTimerRef.current);
    clearTimeout(sleepTimerRef.current);

    if (agentState === 'sleeping') {
      // Despertar al hacer clic
      setAgentState('idle');
      setBubbleOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (bubbleOpen) {
      setBubbleOpen(false);
      setResponse('');
      setError('');
      setStatusText('');
      setAgentState('idle');
    } else {
      setBubbleOpen(true);
      setAgentState('idle');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  // Send message — stateless: solo pregunta y respuesta, luego se borra
  const sendMessage = useCallback(async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setResponse('');
    setError('');
    setLoading(true);
    setAgentState('thinking');
    setStatusText('Pensando...');

    // Después de 5s, cambiar a "Preparando respuesta"
    const prepTimer = setTimeout(() => {
      setStatusText('Preparándote la respuesta...');
    }, 5000);

    try {
      const res = await api.aiChat(text);
      clearTimeout(prepTimer);
      if (res.error) {
        setError(res.error);
        setAgentState('error');
        setStatusText('');
        setTimeout(() => { setAgentState('idle'); setError(''); }, 4000);
      } else {
        setResponse(res.reply);
        setAgentState('responding');
        setStatusText('');
        setTimeout(() => responseRef.current?.scrollTo(0, responseRef.current.scrollHeight), 50);
        // Auto-cerrar después de 30s
        setTimeout(() => {
          setResponse('');
          setAgentState('idle');
        }, 30000);
      }
    } catch (err) {
      clearTimeout(prepTimer);
      setError(err.message);
      setAgentState('error');
      setStatusText('');
      setTimeout(() => { setAgentState('idle'); setError(''); }, 4000);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  // Compute sprite background position
  const anim = ANIM_MAP[agentState];
  const col = anim.frames[frameIdx % anim.frames.length];
  const row = agentState === 'walking' ? (direction === 1 ? 2 : 2) : anim.row;
  const bgX = -(col * FRAME_W * SCALE);
  const bgY = -(row * FRAME_H * SCALE);
  const flipX = agentState === 'walking' && direction === -1;

  return (
    <div className="pixel-agent-container" style={{ left: posX }}>
      {/* Speech bubble */}
      {bubbleOpen && (
        <div className="pixel-bubble">
          <div className="pixel-bubble-arrow" />

          {/* Respuesta */}
          {response && (
            <div className="pixel-bubble-history" ref={responseRef}>
              <div className="pixel-bubble-msg assistant">
                <div className="pixel-bubble-text chat-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(response) }} />
              </div>
            </div>
          )}

          {/* Thinking/preparing indicator */}
          {loading && (
            <div className="pixel-bubble-thinking">
              <span className="pixel-status-label">{statusText}</span>
              <span className="pixel-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          )}

          {/* Error indicator */}
          {error && !loading && (
            <div className="pixel-bubble-error">⚠️ {error}</div>
          )}

          {/* Input */}
          <form className="pixel-bubble-form" onSubmit={sendMessage}>
            <input
              ref={inputRef}
              type="text"
              className="pixel-bubble-input"
              placeholder="Pregúntame algo..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={loading}
            />
            <button type="submit" className="pixel-bubble-send" disabled={!input.trim() || loading}>
              ➤
            </button>
          </form>
        </div>
      )}

      {/* Pixel character */}
      <div
        className={`pixel-agent-sprite ${agentState} ${bubbleOpen ? 'active' : ''}`}
        onClick={handleClick}
        title="Haz clic para hablar conmigo"
        style={{
          width: SPRITE_W,
          height: SPRITE_H,
          backgroundImage: 'url(/char_0.png)',
          backgroundPosition: `${bgX}px ${bgY}px`,
          backgroundSize: `${112 * SCALE}px ${96 * SCALE}px`,
          imageRendering: 'pixelated',
          transform: flipX ? 'scaleX(-1)' : 'none',
        }}
      />

      {/* Sleeping Zzz */}
      {agentState === 'sleeping' && (
        <div className="pixel-agent-zzz">
          <span>z</span><span>z</span><span>Z</span>
        </div>
      )}

    </div>
  );
}
