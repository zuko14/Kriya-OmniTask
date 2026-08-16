import styles from './AsyncState.module.css';
import { ApiError } from '../lib/apiClient';

interface AsyncStateProps {
  status: 'loading' | 'error' | 'empty';
  error?: unknown;
  emptyMessage?: string;
}

export function AsyncState({ status, error, emptyMessage = 'No data yet.' }: AsyncStateProps) {
  if (status === 'loading') {
    return <div className={styles.state}>Loading…</div>;
  }

  if (status === 'error') {
    if (error instanceof ApiError && error.statusCode === 403) {
      return <div className={`${styles.state} ${styles.denied}`}>Access denied — you don't have permission to view this.</div>;
    }
    const message = error instanceof ApiError ? error.message : 'Something went wrong loading this data.';
    return <div className={`${styles.state} ${styles.error}`}>{message}</div>;
  }

  return <div className={styles.state}>{emptyMessage}</div>;
}
