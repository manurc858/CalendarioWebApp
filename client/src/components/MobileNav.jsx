// Dock de navegación móvil: cristal flotante estilo Instagram con
// orbe central "Hoy" que muestra la fecha real. Solo visible ≤768px (CSS).
const DOW_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

const ICONS = {
  weekly: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm0 4h14M7 3v4m6-4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  monthly: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm0 4h14M7 3v4m6-4v4M6.5 12h1m3 0h1m3 0h1M6.5 14.5h1m3 0h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  annual: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14M7 4V2.5m6 1.5V2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="11.5" r="0.8" fill="currentColor" />
      <circle cx="10" cy="11.5" r="0.8" fill="currentColor" />
      <circle cx="13" cy="11.5" r="0.8" fill="currentColor" />
      <circle cx="7" cy="14" r="0.8" fill="currentColor" />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" />
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2.5 6.5a2 2 0 0 1 2-2h2.7l1.8 2H15.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
};

function DockTab({ id, label, view, onChangeView }) {
  return (
    <button
      className={`dock-tab ${view === id ? 'active' : ''}`}
      onClick={() => onChangeView(id)}
      aria-label={label}
      aria-current={view === id ? 'page' : undefined}
    >
      {ICONS[id]}
      <span>{label}</span>
    </button>
  );
}

export default function MobileNav({ view, onChangeView, onToday, todayDate }) {
  return (
    <nav className="mobile-dock" aria-label="Navegación de vistas">
      <DockTab id="weekly" label="Semana" view={view} onChangeView={onChangeView} />
      <DockTab id="monthly" label="Mes" view={view} onChangeView={onChangeView} />
      <button className="dock-orb" onClick={onToday} aria-label={`Ver el día de hoy, ${todayDate.getDate()}`}>
        <span className="dock-orb-dow">{DOW_SHORT[todayDate.getDay()]}</span>
        <span className="dock-orb-num">{todayDate.getDate()}</span>
      </button>
      <DockTab id="annual" label="Año" view={view} onChangeView={onChangeView} />
      <DockTab id="projects" label="Proyectos" view={view} onChangeView={onChangeView} />
    </nav>
  );
}
