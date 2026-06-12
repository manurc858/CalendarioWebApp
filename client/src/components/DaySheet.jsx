import { useEffect, useRef } from 'react';
import DayDetailPanel from './DayDetailPanel.jsx';

// Bottom sheet móvil con el detalle completo (editable) de un día.
// Lo abren: tocar un día en la vista mensual, el orbe "Hoy" del dock
// y los días de la vista anual.
export default function DaySheet({ date, laborMap, projects, onReload, onClose }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement;
    if (!dialog.open) dialog.showModal();

    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };

    const onBackdropClick = (e) => {
      if (e.target === dialog) onClose();
    };

    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdropClick);

    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdropClick);
      if (dialog.open) dialog.close();
      const toFocus = restoreFocusRef.current;
      if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
        requestAnimationFrame(() => toFocus.focus());
      }
    };
  }, [onClose]);

  return (
    <dialog ref={dialogRef} className="mn-editor-dialog day-sheet-dialog" aria-label="Detalle del día">
      <div className="mn-editor day-sheet">
        <div className="day-sheet-header">
          <button type="button" className="day-sheet-close" onClick={onClose} aria-label="Cerrar detalle del día">✕</button>
        </div>
        <div className="day-sheet-body">
          <DayDetailPanel
            key={date}
            date={date}
            laborMap={laborMap}
            projects={projects}
            onReload={onReload}
          />
        </div>
      </div>
    </dialog>
  );
}
