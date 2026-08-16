import { NavLink } from 'react-router';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  to?: string;
}

const CLIENT_NAV: NavItem[] = [
  { label: 'Overview', to: '/app/overview' },
  { label: 'Customers', to: '/app/customers' },
  { label: 'Conversations', to: '/app/conversations' },
  { label: 'Digital Workforce', to: '/app/agents' },
  { label: 'Agents', to: '/app/agents' },
  { label: 'Workflows', to: '/app/workflows' },
  { label: 'Human Attention', to: '/app/attention' },
  { label: 'Analytics', to: '/app/analytics' },
  { label: 'Business Intelligence', to: '/app/bi' },
  { label: 'Knowledge', to: '/app/knowledge' },
  { label: 'Billing', to: '/app/billing' },
  { label: 'Settings', to: '/app/settings' },
];

const PLATFORM_NAV: NavItem[] = [
  { label: 'Overview', to: '/platform/overview' },
  { label: 'Tenants', to: '/platform/tenants' },
  { label: 'Agent Fleet', to: '/platform/fleet' },
  { label: 'Model Health', to: '/platform/models' },
  { label: 'Security', to: '/platform/security' },
  { label: 'Billing', to: '/platform/billing' },
  { label: 'Audit', to: '/platform/audit' },
];

export interface SidebarProps {
  plane: 'client' | 'platform';
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ plane, isOpen = false, onClose }: SidebarProps) {
  const items = plane === 'client' ? CLIENT_NAV : PLATFORM_NAV;
  const sectionTitle = plane === 'client' ? 'Business Control' : 'Platform Control';

  return (
    <>
      {isOpen && (
        <div
          className={styles.mobileBackdrop}
          onClick={onClose}
          aria-hidden="true"
          data-testid="sidebar-mobile-backdrop"
        />
      )}
      <nav
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
        aria-label="Main navigation"
        id="main-sidebar"
      >
        <div className={styles.mobileHeader}>
          <div className={styles.sectionTitle}>{sectionTitle}</div>
          <button
            onClick={onClose}
            className={styles.mobileCloseBtn}
            aria-label="Close navigation drawer"
          >
            ✕
          </button>
        </div>
        {items.map((item) =>
          item.to ? (
            <NavLink
              key={item.label}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
            >
              {item.label}
            </NavLink>
          ) : (
            <div key={item.label} className={styles.linkDisabled} aria-disabled="true">
              {item.label}
              <span className={styles.soon}>Soon</span>
            </div>
          )
        )}
      </nav>
    </>
  );
}
