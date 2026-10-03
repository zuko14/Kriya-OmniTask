import { useId } from 'react';

/**
 * The Kriya mark (KRIYA_AI_DESIGN_SYSTEM.md §1.1): hexagon shield, K stem + arm, central diamond.
 * Canonical 32×32 viewBox. Decorative by default because it is always paired with the
 * "Kriya AI" wordmark (§1.1 rule 2); pass `title` only where it stands alone.
 * Sizes: 36 login · 24 shell header · 26 platform header · 32 favicon (web/public/favicon.svg).
 */
export function KriyaMark({ size = 24, title }: { size?: number; title?: string }) {
  // Gradient ids must be unique per instance: two marks on one page would otherwise share defs.
  const id = useId().replace(/:/g, '');
  const hex = `${id}-hex`;
  const stem = `${id}-stem`;
  const arm = `${id}-arm`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={hex} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#43E2A6" />
          <stop offset="1" stopColor="#3D8BFD" />
        </linearGradient>
        <linearGradient id={stem} x1="11.2" y1="7.6" x2="11.2" y2="24.4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#43E2A6" />
          <stop offset="1" stopColor="#0C9668" />
        </linearGradient>
        <linearGradient id={arm} x1="18.5" y1="24.4" x2="18.5" y2="7.6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3D8BFD" />
          <stop offset="0.5" stopColor="#2FA8D8" />
          <stop offset="1" stopColor="#43E2A6" />
        </linearGradient>
      </defs>
      <path d="M16 2.2 27.9 9v13.6L16 29.4 4.1 22.6V9z" stroke={`url(#${hex})`} strokeWidth="1.4" strokeOpacity="0.4" strokeLinejoin="round" />
      <path d="M11.2 7.6v16.8" stroke={`url(#${stem})`} strokeWidth="3.6" strokeLinecap="round" />
      <path d="M22.9 7.6 14.2 16l8.7 8.4" stroke={`url(#${arm})`} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.2 13.3 16.9 16l-2.7 2.7L11.5 16z" fill="#9FF0D2" />
    </svg>
  );
}
