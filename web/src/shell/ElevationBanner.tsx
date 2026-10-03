import { useState, useEffect } from 'react';
import { useAuth } from '../lib/authContext';
import { Icon } from '../components/brand/Icon';

export function ElevationBanner() {
  const { auth, logout } = useAuth();
  const [timeLeft, setTimeLeft] = useState<string>('');

  // Check if current session is an elevated operator session
  const isElevated = Boolean(auth?.user?.roles?.includes('operator') || (auth as any)?.isElevated);
  const elevatedUntil = (auth as any)?.elevatedUntil || (auth?.user as any)?.elevatedUntil;
  const reason = (auth as any)?.elevationReason || (auth?.user as any)?.elevationReason || 'Operator Maintenance';

  useEffect(() => {
    if (!elevatedUntil) {
      setTimeLeft('');
      return;
    }

    const interval = setInterval(() => {
      const remainingMs = new Date(elevatedUntil).getTime() - Date.now();
      if (remainingMs <= 0) {
        setTimeLeft('EXPIRED');
        clearInterval(interval);
      } else {
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        setTimeLeft(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [elevatedUntil]);

  if (!isElevated && !elevatedUntil) {
    return null;
  }

  return (
    <aside
      aria-label="Elevated operator session active"
      style={{
        width: '100%',
        backgroundColor: 'var(--amber-bg)',
        borderBottom: 'var(--border-width) solid var(--amber)',
        color: 'var(--text)',
        padding: 'var(--space-2) var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-body)',
        zIndex: 90,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--amber)', fontWeight: 700, fontSize: 'var(--text-sm)' }}>
          <Icon name="alert" />
          ELEVATED SESSION
        </span>
        <span>·</span>
        <span>
          Operator <strong>{auth?.user?.fullName || 'Platform Operator'}</strong> elevated into tenant{' '}
          <strong>{auth?.tenant?.name || 'Target Tenant'}</strong>
        </span>
        <span>·</span>
        <span style={{ color: 'var(--text2)' }}>Reason: &quot;{reason}&quot;</span>
        {timeLeft && (
          <>
            <span>·</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)', fontWeight: 600 }}>
              Expires in {timeLeft}
            </span>
          </>
        )}
      </div>

      <button
        onClick={logout}
        style={{
          background: 'var(--surface)',
          border: 'var(--border-width) solid var(--amber)',
          color: 'var(--amber)',
          borderRadius: 'var(--radius-sm)',
          padding: '2px var(--space-2)',
          fontSize: 'var(--text-2xs)',
          fontFamily: 'var(--font-body)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
        aria-label="End elevated operator session"
      >
        End Elevation
      </button>
    </aside>
  );
}
