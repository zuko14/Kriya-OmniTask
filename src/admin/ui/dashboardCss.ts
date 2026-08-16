/**
 * Xylarc AI — Admin Control Plane Design System & Stylesheet
 * Rich glassmorphic dark theme, curated HSL color palette, modern typography, responsive bento grids.
 */

export const DASHBOARD_CSS = `
:root {
  --bg-base: #06080e;
  --bg-surface: #0c101c;
  --bg-surface-elevated: #131a2e;
  --bg-surface-glass: rgba(16, 22, 38, 0.72);
  --border-glass: rgba(255, 255, 255, 0.08);
  --border-glass-hover: rgba(0, 240, 255, 0.35);
  
  --color-primary: #00f0ff;
  --color-primary-glow: rgba(0, 240, 255, 0.25);
  --color-indigo: #6366f1;
  --color-purple: #a855f7;
  --color-success: #10b981;
  --color-success-glow: rgba(16, 185, 129, 0.2);
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-danger-glow: rgba(239, 68, 68, 0.25);
  
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-subtle: #64748b;
  
  --font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-family-display: 'Outfit', 'Inter', sans-serif;
  --font-family-mono: 'JetBrains Mono', 'Fira Code', Menlo, monospace;
  
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-full: 9999px;
  
  --shadow-glass: 0 12px 36px 0 rgba(0, 0, 0, 0.55);
  --transition-fast: 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  --transition-smooth: 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background-color: var(--bg-base);
  background-image: 
    radial-gradient(at 0% 0%, rgba(0, 240, 255, 0.08) 0px, transparent 50%),
    radial-gradient(at 100% 0%, rgba(99, 102, 241, 0.1) 0px, transparent 50%),
    radial-gradient(at 50% 100%, rgba(168, 85, 247, 0.06) 0px, transparent 50%);
  background-attachment: fixed;
  color: var(--text-main);
  font-family: var(--font-family-sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  overflow-x: hidden;
}

/* App Shell Layout */
#app-shell {
  display: flex;
  min-height: 100vh;
}

/* Sidebar Navigation */
#sidebar {
  width: 270px;
  background: var(--bg-surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid var(--border-glass);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
}

.brand-container {
  padding: 24px 20px;
  border-bottom: 1px solid var(--border-glass);
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo-badge {
  width: 38px;
  height: 38px;
  background: linear-gradient(135deg, var(--color-primary), var(--color-indigo));
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-family-display);
  font-weight: 800;
  font-size: 18px;
  color: #040814;
  box-shadow: 0 0 18px var(--color-primary-glow);
}

.brand-text-wrapper h1 {
  font-family: var(--font-family-display);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: linear-gradient(90deg, #ffffff, #a5f3fc);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-text-wrapper span {
  font-size: 11px;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

.nav-section-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--text-subtle);
  font-weight: 700;
  padding: 20px 20px 8px 20px;
}

.nav-links {
  list-style: none;
  padding: 0 12px;
  flex: 1;
  overflow-y: auto;
}

.nav-item {
  margin-bottom: 4px;
}

.nav-btn {
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: var(--transition-fast);
  text-align: left;
}

.nav-btn:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border-glass);
}

.nav-btn.active {
  color: var(--color-primary);
  background: rgba(0, 240, 255, 0.08);
  border-color: rgba(0, 240, 255, 0.25);
  box-shadow: inset 0 0 12px rgba(0, 240, 255, 0.06);
}

.nav-icon {
  font-size: 16px;
  line-height: 1;
}

.sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-glass);
}

.system-status-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.03);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-glass);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-success);
  box-shadow: 0 0 8px var(--color-success);
  animation: pulse-glow 2s infinite;
}

@keyframes pulse-glow {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}

/* Main Content Area */
#main-content {
  flex: 1;
  margin-left: 270px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Top App Bar */
#top-bar {
  height: 68px;
  background: var(--bg-surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-glass);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  position: sticky;
  top: 0;
  z-index: 90;
}

.top-bar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-family: var(--font-family-display);
  font-size: 19px;
  font-weight: 700;
  color: var(--text-main);
}

.top-bar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.token-input-wrapper {
  display: flex;
  align-items: center;
  background: var(--bg-surface);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  width: 280px;
}

.token-input-wrapper input {
  background: transparent;
  border: none;
  color: var(--text-main);
  font-family: var(--font-family-mono);
  font-size: 11px;
  width: 100%;
  outline: none;
}

.btn-action {
  background: linear-gradient(135deg, rgba(0, 240, 255, 0.15), rgba(99, 102, 241, 0.2));
  border: 1px solid rgba(0, 240, 255, 0.3);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: var(--transition-fast);
}

.btn-action:hover {
  background: linear-gradient(135deg, rgba(0, 240, 255, 0.25), rgba(99, 102, 241, 0.35));
  box-shadow: 0 0 16px var(--color-primary-glow);
  transform: translateY(-1px);
}

.btn-danger {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.22);
  box-shadow: 0 0 16px var(--color-danger-glow);
}

/* View Content Container */
.view-container {
  padding: 32px;
  display: none;
}

.view-container.active {
  display: block;
  animation: fadeIn 0.22s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Bento Grid */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}

.col-3 { grid-column: span 3; }
.col-4 { grid-column: span 4; }
.col-6 { grid-column: span 6; }
.col-8 { grid-column: span 8; }
.col-12 { grid-column: span 12; }

/* Cards & Glass Panels */
.glass-card {
  background: var(--bg-surface-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  padding: 22px;
  box-shadow: var(--shadow-glass);
  position: relative;
  overflow: hidden;
  transition: var(--transition-smooth);
}

.glass-card:hover {
  border-color: var(--border-glass-hover);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.card-title {
  font-family: var(--font-family-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Stat Widgets */
.stat-widget {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-family: var(--font-family-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--text-main);
  letter-spacing: -0.5px;
}

.stat-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
}

.badge-success { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.3); }
.badge-primary { background: rgba(0, 240, 255, 0.15); color: #67e8f9; border: 1px solid rgba(0, 240, 255, 0.3); }
.badge-warning { background: rgba(245, 158, 11, 0.15); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.3); }
.badge-danger { background: rgba(239, 68, 68, 0.15); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); }

/* Data Tables */
.table-container {
  width: 100%;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.data-table th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-subtle);
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-glass);
}

.data-table td {
  padding: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  font-size: 13px;
}

.data-table tr:hover td {
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-main);
}

/* Modal Overlay */
#modal-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(4, 6, 12, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 1000;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

#modal-overlay.active {
  display: flex;
}

.modal-dialog {
  background: var(--bg-surface);
  border: 1px solid var(--color-primary);
  box-shadow: 0 0 40px rgba(0, 240, 255, 0.2);
  border-radius: var(--radius-lg);
  max-width: 720px;
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  padding: 28px;
}

/* Toast Notifications */
#toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 1100;
}

.toast {
  background: var(--bg-surface-elevated);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-sm);
  padding: 12px 18px;
  box-shadow: var(--shadow-glass);
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 280px;
  animation: slideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Responsive Media Queries */
@media (max-width: 1024px) {
  .col-3 { grid-column: span 6; }
  .col-4 { grid-column: span 6; }
  .col-6 { grid-column: span 12; }
  .col-8 { grid-column: span 12; }
}

@media (max-width: 768px) {
  #sidebar { width: 70px; }
  .brand-text-wrapper, .nav-text, .nav-section-title, .sidebar-footer span { display: none; }
  #main-content { margin-left: 70px; }
  .col-3, .col-4 { grid-column: span 12; }
  .token-input-wrapper { width: 180px; }
}
`;
