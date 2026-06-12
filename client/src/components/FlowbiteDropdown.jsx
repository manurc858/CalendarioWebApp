import { useEffect, useId } from 'react';
import { initDropdowns } from 'flowbite';

export default function FlowbiteDropdown({
  value,
  options,
  onChange,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  buttonStyle,
  disabled = false,
  ariaLabel,
}) {
  const reactId = useId().replace(/:/g, '');
  const dropdownId = `fb-dropdown-${reactId}`;
  const triggerId = `fb-dropdown-trigger-${reactId}`;
  const selectedOption = options.find((opt) => String(opt.value) === String(value));
  const selectedLabel = selectedOption?.label || options[0]?.label || 'Seleccionar';

  useEffect(() => {
    initDropdowns();
  }, [dropdownId]);

  const handleSelect = (nextValue) => {
    onChange(String(nextValue));
    const trigger = document.getElementById(triggerId);
    if (trigger) trigger.click();
  };

  return (
    <div className={`fb-dropdown ${className}`}>
      <button
        id={triggerId}
        data-dropdown-toggle={dropdownId}
        data-dropdown-trigger="click"
        data-dropdown-placement="bottom-start"
        type="button"
        className={`fb-dropdown-btn ${buttonClassName}`}
        style={buttonStyle}
        disabled={disabled}
        aria-label={ariaLabel || selectedLabel}
      >
        <span className="fb-dropdown-btn-label">{selectedLabel}</span>
        <svg className="fb-dropdown-btn-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
          <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 9-7 7-7-7" />
        </svg>
      </button>

      <div id={dropdownId} className={`z-10 hidden fb-dropdown-menu ${menuClassName}`} aria-labelledby={triggerId}>
        <ul className="fb-dropdown-list" role="listbox" aria-labelledby={triggerId}>
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <li key={String(opt.value)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`fb-dropdown-item ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelect(opt.value)}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}