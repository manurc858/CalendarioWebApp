import { motion } from 'motion/react';

export function FluidTabs({ tabs = [], active, onChange }) {
  const handleChange = (id) => {
    onChange?.(id);
  };

  return (
    <div className="fluid-tabs-root">
      {tabs.map((tab) => {
        const isActive = (active ?? tabs[0]?.id) === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => handleChange(tab.id)}
            className={`fluid-tab-btn${isActive ? ' fluid-tab-btn--active' : ''}`}
            aria-selected={isActive}
            role="tab"
          >
            {isActive && (
              <motion.div
                layoutId="fluid-active-pill"
                transition={{ type: 'spring', stiffness: 280, damping: 25, mass: 0.8 }}
                className="fluid-tab-pill"
              />
            )}
            <motion.div
              transition={{ duration: 0.3, ease: 'easeOut' }}
              animate={{ filter: isActive ? ['blur(0px)', 'blur(4px)', 'blur(0px)'] : 'blur(0px)' }}
              className="fluid-tab-content"
            >
              <motion.span
                animate={{ scale: isActive ? 1.05 : 1 }}
                transition={{ scale: { type: 'spring', stiffness: 300, damping: 15 } }}
                className="fluid-tab-icon"
              >
                {tab.icon}
              </motion.span>
              <span className="fluid-tab-label">{tab.label}</span>
            </motion.div>
          </button>
        );
      })}
    </div>
  );
}
