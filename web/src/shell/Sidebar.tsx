import { NavLink } from 'react-router';
import { useBusinessDna } from '../lib/dnaContext';
import { Icon } from '../components/brand/Icon';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  to: string;
  capability?: string;
}

const PLATFORM_NAV = [
  { label: 'Overview', to: '/platform/overview' },
  { label: 'Tenants', to: '/platform/tenants' },
  { label: 'Agent Fleet', to: '/platform/fleet' },
  { label: 'Model Health', to: '/platform/models' },
  { label: 'Model Registry', to: '/platform/models/registry' },
  { label: 'Skills', to: '/platform/skills' },
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
  const { vocabulary, hasCapability } = useBusinessDna();

  // Dynamic 10-item client navigation rail (§18)
  const clientNav: NavItem[] = [
    { label: 'Today', to: '/app/overview' },
    { label: 'Workforce', to: '/app/agents' },
    { label: vocabulary.customer_plural || 'Customers', to: '/app/customers', capability: 'lead_qualification' },
    { label: 'Conversations', to: '/app/conversations' },
    { label: 'Human Attention', to: '/app/attention' },
    { label: 'Automation', to: '/app/workflows' },
    { label: 'Run Traces', to: '/app/traces' },
    { label: 'Proof Receipts', to: '/app/proof' },
    { label: 'Verification Queue', to: '/app/verification' },
    { label: 'Mandates', to: '/app/mandates' },
    { label: 'Cost per Outcome', to: '/app/cost' },
    { label: 'Analytics', to: '/app/analytics' },
    { label: 'Insights', to: '/app/bi' },
    { label: 'Knowledge', to: '/app/knowledge' },
    { label: 'Brain', to: '/app/brain' },
    { label: 'Settings', to: '/app/settings' },
  ];

  // "Everything the DNA profile doesn't activate is absent, not greyed out." (§3, §18)
  const filteredClientNav = clientNav.filter((item) => {
    if (!item.capability) return true;
    return hasCapability(item.capability);
  });

  const items = plane === 'client' ? filteredClientNav : PLATFORM_NAV;
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
            <Icon name="close" />
          </button>
        </div>
        {items.map((item) => (
          <NavLink
            key={item.to + item.label}
            to={item.to}
            onClick={onClose}
            className={({ isActive }) => (isActive ? `${styles.link} ${styles.linkActive}` : styles.link)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
