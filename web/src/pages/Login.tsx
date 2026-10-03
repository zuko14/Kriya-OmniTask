import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth, ApiError } from '../lib/authContext';
import { getBranding } from '../lib/branding';
import { KriyaMark } from '../components/brand/KriyaMark';
import { Icon } from '../components/brand/Icon';
import styles from './Login.module.css';

/**
 * One sign-in screen, two portals:
 *  - /admin  → client admin portal (workspace + email + password)
 *  - /owner  → platform owner console (email + password; the platform workspace is implied server-side)
 */
export function Login({ variant = 'admin' }: { variant?: 'admin' | 'owner' }) {
  const { auth, login, loginOwner } = useAuth();
  const location = useLocation();
  const branding = getBranding();
  const isOwner = variant === 'owner';
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in to *this* portal → straight to the panel. A session for the other portal
  // doesn't count; signing in here replaces it.
  if (auth && auth.isPlatformOperator === isOwner) {
    const home = isOwner ? '/owner/overview' : '/admin/overview';
    const from = (location.state as { from?: string })?.from;
    return <Navigate to={from?.startsWith(`/${variant}/`) ? from : home} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isOwner) {
        await loginOwner(email, password);
      } else {
        await login(tenantSlug.trim().toLowerCase(), email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.brand}>
          <div className={styles.markTile}>
            <KriyaMark size={36} />
          </div>
          <div className={styles.wordmark}>{branding.companyName}</div>
          <div className={styles.product}>{branding.shortName}</div>
        </div>
        <h1 className={styles.title}>{isOwner ? 'Owner Console' : 'Admin Portal'}</h1>
        <p className={styles.subtitle}>
          {isOwner
            ? 'Platform operators only. Create, monitor and govern client workspaces.'
            : 'Sign in to your workspace with the credentials from your Kriya account team.'}
        </p>
        {!isOwner && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tenantSlug">
              Workspace
            </label>
            <input
              id="tenantSlug"
              className={styles.input}
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              autoComplete="organization"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. sunrise-clinic"
              required
            />
          </div>
        )}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <div className={styles.passwordRow}>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} />
            </button>
          </div>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        <button className={`btn btn-accent ${styles.submit}`} type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
