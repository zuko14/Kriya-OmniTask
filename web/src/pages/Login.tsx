import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth, ApiError } from '../lib/authContext';
import { getBranding } from '../lib/branding';
import { KriyaMark } from '../components/brand/KriyaMark';
import { Icon } from '../components/brand/Icon';
import styles from './Login.module.css';

export function Login() {
  const { auth, login } = useAuth();
  const location = useLocation();
  const branding = getBranding();
  const [tenantSlug, setTenantSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth) {
    const from = (location.state as { from?: string })?.from ?? '/app/overview';
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(tenantSlug, email, password);
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
        <h1 className={styles.title}>Sign in to {branding.companyName}</h1>
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
            required
          />
        </div>
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
