import styles from './AsyncState.module.css';
import { ApiError } from '../lib/apiClient';

interface AsyncStateProps {
  status: 'loading' | 'error' | 'empty';
  error?: unknown;
  emptyMessage?: string;
}

export function AsyncState({ status, error, emptyMessage = 'No data yet.' }: AsyncStateProps) {
  if (status === 'loading') {
    return (
      <div className={styles.state} role="status">
        <span className={`spinner ${styles.spinner}`} aria-hidden="true" />
        Loading…
      </div>
    );
  }

  if (status === 'error') {
    if (error instanceof ApiError && error.statusCode === 403) {
      return (
        <div className="alert alert-warn" role="alert">
          Access denied — you don't have permission to view this.
        </div>
      );
    }
    const message = error instanceof ApiError ? error.message : 'Something went wrong loading this data.';
    return (
      <div className="alert alert-err" role="alert">
        {message}
      </div>
    );
  }

  return <div className={styles.state}>{emptyMessage}</div>;
}
