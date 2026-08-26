// Dock móvil: 3 ítems (Agenda · Hoy · Proyectos) con efecto liquid glass.
// El cristal usa un SVG feDisplacementMap para distorsión en los bordes
// (visible en Chromium; Safari aplica solo backdrop-filter como fallback).
const DOW_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

const ICONS = {
  monthly: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm0 4h14M7 3v4m6-4v4M6.5 12h1m3 0h1m3 0h1M6.5 14.5h1m3 0h1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2.5 6.5a2 2 0 0 1 2-2h2.7l1.8 2H15.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
};

// «Agenda» se activa también en las vistas weekly y annual para que siempre
// haya un ítem activo al arrancar la app en móvil (vista por defecto: weekly).
function DockTab({ id, label, view, onChangeView, activeWhen = [] }) {
  const isActive = view === id || activeWhen.includes(view);
  return (
    <button
      className={`dock-tab ${isActive ? 'active' : ''}`}
      onClick={() => onChangeView(id)}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
    >
      {ICONS[id]}
      <span>{label}</span>
    </button>
  );
}

export default function MobileNav({ view, onChangeView, onToday, todayDate }) {
  return (
    <>
      {/* Definición del filtro SVG para el efecto liquid glass en los bordes */}
      <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        <defs>
          <filter id="dock-liquid-glass" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.022 0.016" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="7" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <nav className="mobile-dock" aria-label="Navegación de vistas">
        {/* Capa de cristal líquido: backdrop separado del contenido para que
            los iconos queden nítidos mientras el fondo se distorsiona */}
        <span className="dock-warp" aria-hidden="true" />

        <DockTab
          id="monthly"
          label="Agenda"
          view={view}
          onChangeView={onChangeView}
          activeWhen={['weekly', 'annual']}
        />
        <button
          className="dock-orb"
          onClick={onToday}
          aria-label={`Ver el día de hoy, ${todayDate.getDate()}`}
          aria-current={view === 'today' ? 'page' : undefined}
        >
          <span className="dock-orb-dow">{DOW_SHORT[todayDate.getDay()]}</span>
          <span className="dock-orb-num">{todayDate.getDate()}</span>
        </button>
        <DockTab id="projects" label="Proyectos" view={view} onChangeView={onChangeView} />
      </nav>
    </>
  );
}
