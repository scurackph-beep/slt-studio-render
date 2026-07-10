import './BrandLogo.css';

export default function BrandLogo({ className = '' }) {
  return (
    <div className={`brand-logo ${className}`.trim()} aria-label="Sweet Little Trauma Studio">
      <span className="brand-logo-top">SWEET LITTLE TRAUMA</span>
      <span className="brand-logo-sub">STUDIO</span>
    </div>
  );
}
