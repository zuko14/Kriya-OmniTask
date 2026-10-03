import { ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  emptyMessage?: string;
  ariaLabel?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No records found.',
  ariaLabel = 'Data table',
}: DataTableProps<T>) {
  if (!data || data.length === 0) {
    return <div className={styles.emptyState}>{emptyMessage}</div>;
  }

  return (
    <div className={styles.tableContainer}>
      <table className={styles.table} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={keyExtractor(row)}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
