import { useEffect, useId, useRef, useCallback } from 'react';
import { Datepicker } from 'flowbite-datepicker';

function toIso(value) {
  if (!value) return '';
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return text;
  const alt = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (alt) return `${alt[3]}-${alt[1]}-${alt[2]}`;
  return '';
}

export default function FlowbiteDateInput({
  value,
  onValueChange,
  className = '',
  wrapperClassName = '',
  id,
  name,
  required = false,
  title,
  placeholder = 'Selecciona fecha',
  disabled = false,
  autoFocus = false,
}) {
  const generatedId = useId();
  const inputId = id || `fb-datepicker-${generatedId}`;
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  const pickerRef = useRef(null);
  const callbackRef = useRef(onValueChange);
  const suppressRef = useRef(false);

  useEffect(() => { callbackRef.current = onValueChange; }, [onValueChange]);

  // Initialize datepicker once
  useEffect(() => {
    const inputEl = inputRef.current;
    const wrapperEl = wrapperRef.current;
    if (!inputEl || !wrapperEl) return undefined;

    const picker = new Datepicker(inputEl, {
      autohide: true,
      format: 'yyyy-mm-dd',
      todayBtn: false,
      clearBtn: false,
      orientation: 'bottom left',
    });

    pickerRef.current = picker;

    // Portal popup OUTSIDE the React-managed wrapper to avoid
    // "Failed to execute 'removeChild' on 'Node'" when React and Flowbite
    // race to clean up the same DOM node. Prefer the closest <dialog>
    // ancestor so the popup remains in its top-layer; fall back to body.
    const popupEl = picker.pickerElement;
    const portalTarget = wrapperEl.closest('dialog') || document.body;
    if (popupEl && popupEl.parentNode !== portalTarget) {
      portalTarget.appendChild(popupEl);
    }

    // Set initial value
    const initial = toIso(value);
    if (initial) {
      inputEl.value = initial;
      picker.setDate(initial);
    }

    // Reposition popup with position:fixed to escape overflow:hidden/auto ancestors
    const handleShow = () => {
      if (!popupEl) return;
      const rect = inputEl.getBoundingClientRect();
      popupEl.style.position = 'fixed';
      popupEl.style.top = `${rect.bottom + 4}px`;
      popupEl.style.left = `${rect.left}px`;
      popupEl.style.zIndex = '9999';
    };

    // Listen for date changes
    const handleChange = () => {
      if (suppressRef.current) return;
      const selected = toIso(inputEl.value);
      callbackRef.current?.(selected);
    };

    inputEl.addEventListener('changeDate', handleChange);
    inputEl.addEventListener('show', handleShow);

    return () => {
      try { inputEl.removeEventListener('changeDate', handleChange); } catch {}
      try { inputEl.removeEventListener('show', handleShow); } catch {}
      try { picker.destroy(); } catch {}
      if (popupEl && popupEl.parentNode) {
        try { popupEl.parentNode.removeChild(popupEl); } catch {}
      }
      pickerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;

    const inputEl = inputRef.current;
    const picker = pickerRef.current;
    if (!inputEl || !picker) return;

    const normalized = toIso(value);
    const current = toIso(inputEl.value);
    if (normalized === current) return;

    suppressRef.current = true;
    if (normalized) {
      inputEl.value = normalized;
      picker.setDate(normalized);
    } else {
      inputEl.value = '';
      picker.setDate({ clear: true });
    }
    suppressRef.current = false;
  }, [value]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      const iso = toIso(e.target.value);
      callbackRef.current?.(iso);
    }
  }, []);

  const handleBlur = useCallback((e) => {
    const iso = toIso(e.target.value);
    const current = toIso(value);
    if (iso !== current) {
      callbackRef.current?.(iso);
    }
  }, [value]);

  return (
    <div ref={wrapperRef} className={`fb-date-field ${wrapperClassName}`.trim()}>
      <div className="fb-date-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 10h16M8 4v3m8-3v3M5 20h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1Zm3-7h.01v.01H8V13Zm4 0h.01v.01H12V13Zm4 0h.01v.01H16V13Zm-8 4h.01v.01H8V17Zm4 0h.01v.01H12V17Zm4 0h.01v.01H16V17Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="text"
        className={`fb-date-input ${className}`.trim()}
        placeholder={placeholder}
        required={required}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  );
}