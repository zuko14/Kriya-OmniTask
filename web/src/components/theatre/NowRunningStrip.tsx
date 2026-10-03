import React from 'react';
import { TaskChip } from '../primitives/TaskChip';
import styles from './NowRunningStrip.module.css';

export interface RunningTaskItem {
  id: string;
  agentName: string;
  taskType: string;
  summary: string;
  /** Only when the stream reports it; never estimated. */
  elapsedSeconds?: number;
  state?: 'live' | 'learning' | 'attention';
}

export interface NowRunningStripProps {
  tasks?: RunningTaskItem[];
  onSelectTask?: (taskId: string) => void;
}

export function NowRunningStrip({ tasks = [], onSelectTask }: NowRunningStripProps) {
  return (
    <div className={styles.stripContainer} data-testid="now-running-strip" role="region" aria-label="Currently executing tasks">
      <div className={styles.stripLabel}>
        <span className={styles.liveIndicator}>▸</span>
        <span>Now Running</span>
      </div>

      <div className={styles.chipList}>
        {tasks.length === 0 ? (
          <span className={styles.idleNotice}>No active tasks · Standby mode</span>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => onSelectTask?.(task.id)}
              style={{ cursor: onSelectTask ? 'pointer' : 'default' }}
            >
              <TaskChip
                taskType={`${task.agentName}: ${task.taskType}`}
                state={task.state || 'live'}
                elapsed={task.elapsedSeconds === undefined ? undefined : `${task.elapsedSeconds.toFixed(1)}s`}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
