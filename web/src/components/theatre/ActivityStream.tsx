import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Icon } from '../brand/Icon';
import styles from './ActivityStream.module.css';

export interface ActivityStreamEvent {
  id: string;
  seq: number;
  ts: string;
  agentId: string;
  agentName: string;
  type: string;
  outcome: 'live' | 'attention' | 'halt' | 'external' | 'learning' | 'info';
  outcomeLabel: string;
  subject: string;
  evidence?: string;
  hasExternalSource?: boolean;
  taskId?: string;
  channel?: string;
}

export interface ActivityStreamProps {
  events?: ActivityStreamEvent[];
  selectedAgentId?: string | null;
  onOpenTrace?: (taskId: string) => void;
  onFilterAgent?: (agentId: string | null) => void;
}

export function ActivityStream({
  events = [],
  selectedAgentId = null,
  onOpenTrace,
  onFilterAgent,
}: ActivityStreamProps) {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [isScrolledUp, setIsScrolledUp] = useState<boolean>(false);
  const [unreadNewEventsCount, setUnreadNewEventsCount] = useState<number>(0);
  const listRef = useRef<HTMLDivElement>(null);
  const prevEventsLengthRef = useRef<number>(events.length);
  const [lastAnnouncedMessage, setLastAnnouncedMessage] = useState<string>('');

  // Handle auto-scroll pause and resume (§15.3, §15.6)
  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop } = listRef.current;
    if (scrollTop > 50) {
      setIsScrolledUp(true);
    } else {
      setIsScrolledUp(false);
      setUnreadNewEventsCount(0);
    }
  };

  const scrollToTop = () => {
    if (listRef.current) {
      if (typeof listRef.current.scrollTo === 'function') {
        listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        listRef.current.scrollTop = 0;
      }
      setIsScrolledUp(false);
      setUnreadNewEventsCount(0);
    }
  };

  // Detect incoming new events
  useEffect(() => {
    if (events.length > prevEventsLengthRef.current) {
      const addedCount = events.length - prevEventsLengthRef.current;
      if (isScrolledUp) {
        setUnreadNewEventsCount((prev) => prev + addedCount);
      }
      // Announce newest event to assistive technologies (§20)
      const newest = events[0];
      if (newest) {
        setLastAnnouncedMessage(`${newest.agentName} ${newest.outcomeLabel} ${newest.subject}`);
      }
    }
    prevEventsLengthRef.current = events.length;
  }, [events, isScrolledUp]);

  // Filter events based on active chips
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (selectedAgentId && ev.agentId !== selectedAgentId) {
        return false;
      }
      if (activeFilter === 'attention') {
        return ev.outcome === 'attention';
      }
      if (activeFilter === 'failures') {
        return ev.outcome === 'halt';
      }
      if (activeFilter === 'external') {
        return ev.hasExternalSource || ev.outcome === 'external';
      }
      return true;
    }).slice(0, 200); // DOM buffer cap: 200 rows (§15.3)
  }, [events, selectedAgentId, activeFilter]);

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toTimeString().split(' ')[0] || ts;
    } catch {
      return ts;
    }
  };

  const getOutcomeClass = (outcome: string) => {
    switch (outcome) {
      case 'live':
        return styles.outcomeLive;
      case 'attention':
        return styles.outcomeAttention;
      case 'halt':
        return styles.outcomeHalt;
      case 'external':
        return styles.outcomeExternal;
      case 'learning':
        return styles.outcomeLearning;
      default:
        return styles.outcomeLive;
    }
  };

  return (
    <div className={styles.streamContainer} data-testid="activity-stream">
      {/* Screen Reader Live Announcer (§15.3, §20) */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {lastAnnouncedMessage}
      </div>

      {/* Filter Bar (§15.3) */}
      <div className={styles.filterBar} role="toolbar" aria-label="Activity stream filter options">
        <button
          type="button"
          className={`${styles.filterChip} ${activeFilter === 'all' && !selectedAgentId ? styles.filterChipActive : ''}`}
          onClick={() => {
            setActiveFilter('all');
            onFilterAgent?.(null);
          }}
        >
          All Events
        </button>
        <button
          type="button"
          className={`${styles.filterChip} ${activeFilter === 'attention' ? styles.filterChipActive : ''}`}
          onClick={() => setActiveFilter('attention')}
        >
          <Icon name="alert" /> Attention
        </button>
        <button
          type="button"
          className={`${styles.filterChip} ${activeFilter === 'failures' ? styles.filterChipActive : ''}`}
          onClick={() => setActiveFilter('failures')}
        >
          <Icon name="close" /> Failures
        </button>
        <button
          type="button"
          className={`${styles.filterChip} ${activeFilter === 'external' ? styles.filterChipActive : ''}`}
          onClick={() => setActiveFilter('external')}
        >
          ◇ External
        </button>
        {selectedAgentId && (
          <button
            type="button"
            className={`${styles.filterChip} ${styles.filterChipActive}`}
            onClick={() => onFilterAgent?.(null)}
          >
            Agent: {selectedAgentId} <Icon name="close" label="Clear agent filter" />
          </button>
        )}
      </div>

      {/* Stream List */}
      <div
        className={styles.streamList}
        ref={listRef}
        onScroll={handleScroll}
        role="feed"
        aria-label="Live agent activity stream"
        aria-busy={false}
      >
        {filteredEvents.length === 0 ? (
          <div className={styles.idleStateContainer} data-testid="stream-idle-state">
            <div className={styles.idleTitle}>No activity yet</div>
            <div className={styles.idleDescription}>
              No events on the live stream for this view. Nothing is inferred about tasks that did not report.
            </div>
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const timeStr = formatTime(ev.ts);
            const isExternal = ev.hasExternalSource || ev.outcome === 'external';

            return (
              <article
                key={ev.id || `${ev.seq}-${ev.ts}`}
                className={styles.streamRow}
                tabIndex={0}
                role="article"
                aria-label={`Event at ${timeStr}: ${ev.agentName} ${ev.outcomeLabel}, ${ev.subject}`}
                onClick={() => ev.taskId && onOpenTrace?.(ev.taskId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (ev.taskId) onOpenTrace?.(ev.taskId);
                  }
                }}
                data-testid={`stream-row-${ev.seq}`}
              >
                <div className={styles.rowMain}>
                  <time className={styles.timestamp}>{timeStr}</time>
                  <span className={styles.agentName}>{ev.agentName}</span>
                  <span className={`${styles.outcomeBadge} ${getOutcomeClass(ev.outcome)}`}>
                    {isExternal && <span className={styles.externalMarker}>◇</span>}
                    <span>{ev.outcomeLabel}</span>
                  </span>
                  <span className={styles.subject}>{ev.subject}</span>
                </div>
                {ev.evidence && (
                  <div className={styles.rowEvidence}>
                    <span>└</span>
                    <span>{ev.evidence}</span>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {/* Auto-scroll paused resume pill (§15.3) */}
      {isScrolledUp && unreadNewEventsCount > 0 && (
        <button
          type="button"
          className={styles.resumePill}
          onClick={scrollToTop}
          data-testid="resume-scroll-pill"
          aria-label={`${unreadNewEventsCount} new events, click to scroll to top`}
        >
          <span>↑</span>
          <span>{unreadNewEventsCount} new events</span>
        </button>
      )}
    </div>
  );
}
