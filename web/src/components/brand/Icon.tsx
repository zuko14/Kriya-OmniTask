/**
 * Kriya icon set (KRIYA_AI_DESIGN_SYSTEM.md §8): 24×24 grid, 1.75 stroke, round caps/joins,
 * no fill, `currentColor`. No emoji anywhere in the console (§8.2 rule 1).
 * DS §8 set + `alert`, `check`, `menu` needed by the consoles. Geometry follows Feather (MIT).
 * Each <Icon> renders its own paths instead of `<use href>` into a page-level sprite, so it
 * works in isolated renders (tests, portals) with no sprite to mount.
 */
const PATHS = {
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  alert: ['M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  bell: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  building: ['M5 3h14a1 1 0 0 1 1 1v17H4V4a1 1 0 0 1 1-1z', 'M9 21v-4h6v4', 'M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01'],
  card: ['M3 4h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M1 10h22'],
  check: ['M20 6 9 17l-5-5'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  'eye-off': ['M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94', 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19', 'M14.12 14.12a3 3 0 1 1-4.24-4.24', 'M1 1l22 22'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  megaphone: ['M3 11v2a1 1 0 0 0 1 1h3l9 5V5L7 10H4a1 1 0 0 0-1 1z', 'M20 9a3 3 0 0 1 0 6'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  pencil: ['M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
  search: ['M3 11a8 8 0 1 0 16 0a8 8 0 1 0-16 0', 'M21 21l-4.35-4.35'],
  send: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4 20-7z'],
  settings: [
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  ],
  shuffle: ['M16 3h5v5', 'M4 20 21 3', 'M21 16v5h-5', 'M15 15l6 6', 'M4 4l5 5'],
  trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
  'trending-up': ['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  wallet: ['M20 7H5a2 2 0 0 1 0-4h13v4', 'M3 5v14a2 2 0 0 0 2 2h15V7', 'M16 14h.01'],
  zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/** Decorative by default (the control around it carries the label); pass `label` when it stands alone. */
export function Icon({ name, size = 16, label }: { name: IconName; size?: 16 | 20 | 24; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={name}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
