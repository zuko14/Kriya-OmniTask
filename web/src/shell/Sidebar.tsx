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
  { label: 'Overview', to: '/owner/overview' },
  { label: 'Tenants', to: '/owner/tenants' },
  { label: 'Agent Fleet', to: '/owner/fleet' },
  { label: 'Model Health', to: '/owner/models' },
  { label: 'Model Registry', to: '/owner/models/registry' },
  { label: 'Skills', to: '/owner/skills' },
  { label: 'Security', to: '/owner/security' },
  { label: 'Billing', to: '/owner/billing' },
  { label: 'Audit', to: '/owner/audit' },
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
    { label: 'Today', to: '/admin/overview' },
    { label: 'Workforce', to: '/admin/agents' },
    { label: vocabulary.customer_plural || 'Customers', to: '/admin/customers', capability: 'lead_qualification' },
    { label: 'Conversations', to: '/admin/conversations' },
    { label: 'Human Attention', to: '/admin/attention' },
    { label: 'Automation', to: '/admin/workflows' },
    { label: 'Run Traces', to: '/admin/traces' },
    { label: 'Proof Receipts', to: '/admin/proof' },
    { label: 'Verification Queue', to: '/admin/verification' },
    { label: 'Mandates', to: '/admin/mandates' },
    { label: 'Cost per Outcome', to: '/admin/cost' },
    { label: 'Analytics', to: '/admin/analytics' },
    { label: 'Insights', to: '/admin/bi' },
    { label: 'Knowledge', to: '/admin/knowledge' },
    { label: 'Brain', to: '/admin/brain' },
    { label: 'Settings', to: '/admin/settings' },
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
