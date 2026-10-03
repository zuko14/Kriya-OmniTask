import React from 'react';
import { Icon } from '../brand/Icon';
import styles from './HeaderSummary.module.css';

export interface HeaderSummaryProps {
  workingCount: number;
  attentionCount: number;
  doneTodayCount: number;
  activeFilter?: 'all' | 'working' | 'attention' | 'done';
  onSelectFilter?: (filter: 'all' | 'working' | 'attention' | 'done') => void;
}

export function HeaderSummary({
  workingCount,
  attentionCount,
  doneTodayCount,
  activeFilter = 'all',
  onSelectFilter,
}: HeaderSummaryProps) {
  const handleFilterClick = (filter: 'all' | 'working' | 'attention' | 'done') => {
    if (onSelectFilter) {
      onSelectFilter(activeFilter === filter ? 'all' : filter);
    }
  };

  const announcement = `${workingCount} agents working, ${attentionCount} attention items, ${doneTodayCount} tasks completed today.`;

  return (
    <header className={styles.header} role="status" aria-live="polite">
      <div className={styles.titleGroup}>
        <h2 className={styles.title}>Live Workforce</h2>
      </div>

      <div className={styles.metricsGroup} aria-label="Workforce summary metrics">
        <button
          type="button"
          className={`${styles.filterBtn} ${activeFilter === 'working' ? styles.filterBtnActive : ''}`}
          onClick={() => handleFilterClick('working')}
          aria-pressed={activeFilter === 'working'}
          aria-label={`${workingCount} agents working, filter by working`}
        >
          <span className={styles.liveGlyph}>●</span>
          <span>{workingCount} working</span>
        </button>

        <span className={styles.separator} aria-hidden="true">·</span>

        <button
          type="button"
          className={`${styles.filterBtn} ${activeFilter === 'attention' ? styles.filterBtnActive : ''}`}
          onClick={() => handleFilterClick('attention')}
          aria-pressed={activeFilter === 'attention'}
          aria-label={`${attentionCount} items needing attention, filter by attention`}
        >
          <span className={styles.attentionGlyph}><Icon name="alert" /></span>
          <span>{attentionCount} attention</span>
        </button>

        <span className={styles.separator} aria-hidden="true">·</span>

        <button
          type="button"
          className={`${styles.filterBtn} ${activeFilter === 'done' ? styles.filterBtnActive : ''}`}
          onClick={() => handleFilterClick('done')}
          aria-pressed={activeFilter === 'done'}
          aria-label={`${doneTodayCount} tasks done today, filter by completed`}
        >
          <span className={styles.doneGlyph}><Icon name="check" /></span>
          <span>{doneTodayCount} done today</span>
        </button>
      </div>

      {/* Hidden announcer for assistive technologies (§20) */}
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </header>
  );
}
