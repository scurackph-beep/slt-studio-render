import './BrandLogo.css';

export default function BrandLogo({ className = '', variant = 'default' }) {
  const variantClass = variant === 'hero' ? 'brand-logo--hero' : variant === 'compact' ? 'brand-logo--compact' : '';

  return (
    <div className={`brand-logo ${variantClass} ${className}`.trim()} aria-label="Sweet Little Trauma Studio">
      <span className="brand-logo-mark" aria-hidden="true" />
      <div className="brand-logo-copy">
        <span className="brand-logo-top">Sweet Little Trauma</span>
        <span className="brand-logo-sub">Studio</span>
      </div>
    </div>
  );
}
