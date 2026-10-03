import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { ElevationBanner } from './ElevationBanner';
import { CommandPalette } from '../components/CommandPalette';
import { DnaProvider } from '../lib/dnaContext';
import { applyTheme, getStoredTheme, saveTheme, type Theme } from '../lib/theme';

export function AppShell({ plane }: { plane: 'client' | 'platform' }) {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const location = useLocation();

  // Platform console is dark only (DS §12.1); leaving the shell (e.g. to login) restores dark.
  useEffect(() => {
    applyTheme(plane === 'platform' ? 'dark' : theme);
    return () => applyTheme('dark');
  }, [plane, theme]);

  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    saveTheme(next);
    setTheme(next);
  };

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  // Global Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <DnaProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <TopBar
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onToggleMobileNav={() => setIsMobileNavOpen((prev) => !prev)}
          theme={plane === 'client' ? theme : undefined}
          onToggleTheme={plane === 'client' ? toggleTheme : undefined}
        />
        <ElevationBanner />
        <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
          <Sidebar
            plane={plane}
            isOpen={isMobileNavOpen}
            onClose={() => setIsMobileNavOpen(false)}
          />
          <main
            className="shell-main"
            tabIndex={-1}
            id="main-content"
            role="main"
          >
            <Outlet />
          </main>
        </div>

        {/* Global Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
        />
      </div>
    </DnaProvider>
  );
}
