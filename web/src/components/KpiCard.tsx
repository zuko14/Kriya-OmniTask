import type { ReactNode } from 'react';
import styles from './KpiCard.module.css';

interface KpiCardProps {
  title: string;
  value?: string;
  children?: ReactNode;
}

export function KpiCard({ title, value, children }: KpiCardProps) {
  return (
    <div className={`stat ${styles.card}`}>
      <div className="stat-label">{title}</div>
      {value !== undefined && <div className="stat-num">{value}</div>}
      {children && <div className={styles.body}>{children}</div>}
    </div>
  );
}
