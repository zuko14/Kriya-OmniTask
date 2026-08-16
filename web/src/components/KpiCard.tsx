import type { ReactNode } from 'react';
import styles from './KpiCard.module.css';

interface KpiCardProps {
  title: string;
  value?: string;
  children?: ReactNode;
}

export function KpiCard({ title, value, children }: KpiCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>
      {value !== undefined && <div className={styles.value}>{value}</div>}
      {children && <div className={styles.body}>{children}</div>}
    </div>
  );
}
