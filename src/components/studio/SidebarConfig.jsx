export default function SidebarConfig({
  children,
  title = 'Parameters',
  description = 'Provider, prompts and references.',
}) {
  return (
    <div className="gen-sidebar">
      <div className="gen-sidebar-head">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="gen-sidebar-body">{children}</div>
    </div>
  );
}

export function SidebarField({ label, hint, children }) {
  return (
    <label className="gen-field">
      <span className="gen-field-label">{label}</span>
      {hint ? <span className="gen-field-hint">{hint}</span> : null}
      {children}
    </label>
  );
}

export function SidebarSelect({ value, onChange, options = [], placeholder = 'Select' }) {
  return (
    <select className="gen-select" value={value} onChange={onChange}>
      {!value ? <option value="">{placeholder}</option> : null}
      {options.map((option) => {
        const optionValue = typeof option === 'string' ? option : option.value;
        const optionLabel = typeof option === 'string' ? option : option.label;
        return (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        );
      })}
    </select>
  );
}

export function SidebarTextarea({ value, onChange, placeholder, rows = 4, disabled = false }) {
  return (
    <textarea
      className="gen-textarea"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
    />
  );
}

export function SidebarRange({ value, onChange, min = 0, max = 100, step = 1, suffix = '' }) {
  return (
    <div className="gen-range">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
      <span>{value}{suffix}</span>
    </div>
  );
}
