import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Icon } from '../../components/brand/Icon';

/** Shown to the operator exactly once after provisioning — the password is never retrievable again. */
export interface ProvisionedCredentials {
  tenantId: string;
  tenantName: string;
  workspace: string;
  adminEmail: string;
  password: string;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ProvisionTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (credentials: ProvisionedCredentials) => void;
}

export function ProvisionTenantModal({ isOpen, onClose, onSuccess }: ProvisionTenantModalProps) {
  const [step, setStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Identity
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [industry, setIndustry] = useState('retail');
  const [region, setRegion] = useState('ap-south-1');
  const [languages, setLanguages] = useState<string[]>(['en', 'hi']);
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  // Step 2: DNA Profile
  const [dnaProfileId, setDnaProfileId] = useState('dna_retail_commerce');

  // Step 3: Channel Plan & Brain Supply Mode
  const [channelPlan, setChannelPlan] = useState<'whatsapp_only' | 'voice_only' | 'combined'>('combined');
  const [brainSupplyMode, setBrainSupplyMode] = useState<'byo' | 'managed'>('byo');
  const [planTier, setPlanTier] = useState<'starter' | 'growth' | 'enterprise'>('growth');

  // Step 4: Quotas & Autonomy
  const [autonomyCeiling, setAutonomyCeiling] = useState<'L1' | 'L2' | 'L3' | 'L4'>('L2');
  const [monthlyBudgetInr, setMonthlyBudgetInr] = useState(10000);
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(10);

  // Step 5: Admin User Credentials
  const [adminEmail, setAdminEmail] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  if (!isOpen) return null;

  // Keep auto-filling the slug until the operator edits it by hand.
  const toSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const handleNameChange = (val: string) => {
    if (!slug || slug === toSlug(name)) setSlug(toSlug(val));
    setName(val);
  };

  const handleLanguageToggle = (lang: string) => {
    if (languages.includes(lang)) {
      if (languages.length > 1) setLanguages(languages.filter((l) => l !== lang));
    } else {
      setLanguages([...languages, lang]);
    }
  };

  const handleFinalSubmit = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      const result = await apiFetch<{ id: string; slug: string; adminEmail: string; generatedAdminPassword?: string }>('/api/v1/admin/tenants/provision', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          industry,
          region,
          languages,
          timezone,
          dnaProfileId,
          planTier,
          channelPlan,
          brainSupplyMode,
          adminEmail: adminEmail.trim(),
          adminFullName: adminFullName.trim() || `${name} Admin`,
          adminPassword: adminPassword || undefined,
          quotas: {
            max_concurrent_tasks: maxConcurrentTasks,
            monthly_budget_inr: monthlyBudgetInr,
            max_daily_tokens: 1000000,
          },
          autonomyCeiling,
        }),
      });
      onSuccess({
        tenantId: result.id,
        tenantName: name.trim(),
        workspace: result.slug,
        adminEmail: result.adminEmail,
        password: result.generatedAdminPassword ?? adminPassword,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to provision tenant.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 16, 23, 0.85)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-4)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-modal-title"
    >
      <div
        style={{
          background: 'var(--surface)',
          border: 'var(--border-width) solid var(--border2)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elev-3)',
          width: '100%',
          maxWidth: '680px',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        {/* Header */}
        <header style={{ borderBottom: 'var(--border-width) solid var(--border)', paddingBottom: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="eyebrow">Enterprise Tenant Provisioning (§2, §17.2)</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--accent)' }}>
              Step {step} of 6
            </div>
          </div>
          <h2
            id="provision-modal-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-xl)',
              fontWeight: 600,
              color: 'var(--text)',
              margin: 'var(--space-1) 0 0 0',
            }}
          >
            {step === 1 && '1. Business Identity'}
            {step === 2 && '2. Business DNA Profile'}
            {step === 3 && '3. Channels & Brain Supply'}
            {step === 4 && '4. Governance & Quotas'}
            {step === 5 && '5. Initial Admin Account'}
            {step === 6 && '6. Review & Diff Confirmation'}
          </h2>
        </header>

        {error && (
          <div
            style={{
              background: 'var(--red-bg)',
              border: 'var(--border-width) solid var(--red)',
              color: 'var(--red)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
            }}
          >
            {error}
          </div>
        )}

        {/* Step 1: Identity */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Business Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Kaveri Motors"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Tenant Slug *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. kaveri-motors"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Industry / Vertical</label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
                >
                  <option value="retail">Retail &amp; E-Commerce</option>
                  <option value="automotive">Automotive Dealership &amp; Services</option>
                  <option value="logistics">Logistics &amp; Supply Chain</option>
                  <option value="hospitality">Hospitality &amp; Dining</option>
                  <option value="general">General Enterprise Service</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Deployment Region</label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
                >
                  <option value="ap-south-1">ap-south-1 (Mumbai / India)</option>
                  <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                  <option value="eu-west-1">eu-west-1 (Dublin / EU)</option>
                  <option value="us-east-1">us-east-1 (N. Virginia / US)</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)', marginBottom: 'var(--space-1)', display: 'block' }}>
                Operational Languages
              </label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {[
                  { code: 'en', label: 'English (EN)' },
                  { code: 'hi', label: 'Hindi (HI)' },
                  { code: 'te', label: 'Telugu (TE)' },
                  { code: 'ta', label: 'Tamil (TA)' },
                  { code: 'kn', label: 'Kannada (KN)' },
                ].map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => handleLanguageToggle(l.code)}
                    style={{
                      background: languages.includes(l.code) ? 'var(--surface2)' : 'var(--surface3)',
                      border: `var(--border-width) solid ${languages.includes(l.code) ? 'var(--accent)' : 'var(--border)'}`,
                      color: languages.includes(l.code) ? 'var(--text)' : 'var(--text3)',
                      padding: 'var(--space-1) var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-xs)',
                      cursor: 'pointer',
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: DNA Profile */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text3)', margin: 0 }}>
              Business DNA drives entity vocabulary, agent rosters, mandatory tools, and autonomy boundaries without code changes (§3).
            </p>

            {[
              {
                id: 'dna_retail_commerce',
                title: 'Retail & E-Commerce DNA',
                agents: 'Lead Qual, Product Inquiry, Order Status, Support, Retention',
                vocab: 'buyer · SKU · order · cart',
              },
              {
                id: 'dna_automotive_service',
                title: 'Automotive Dealership DNA',
                agents: 'Sales Inbound, Service Booking, Warranty, Post-Delivery CSAT',
                vocab: 'client · vehicle · VIN · bay slot',
              },
              {
                id: 'dna_general_service',
                title: 'General Enterprise Services DNA',
                agents: 'General Inquiries, Triage Specialist, Appointment Booking, Support',
                vocab: 'customer · ticket · appointment',
              },
            ].map((dna) => (
              <div
                key={dna.id}
                onClick={() => setDnaProfileId(dna.id)}
                style={{
                  background: dnaProfileId === dna.id ? 'var(--surface2)' : 'var(--surface3)',
                  border: `var(--border-width) solid ${dnaProfileId === dna.id ? 'var(--green)' : 'var(--border)'}`,
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-1)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ color: 'var(--text)', fontSize: 'var(--text-sm)' }}>{dna.title}</strong>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>{dna.id}</span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Workforce: {dna.agents}</div>
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>Vocabulary: {dna.vocab}</div>
              </div>
            ))}
          </div>
        )}

        {/* Step 3: Channels & Brain Supply */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)', marginBottom: 'var(--space-2)', display: 'block' }}>
                Channel Plan Entitlement
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                {[
                  { id: 'whatsapp_only', label: 'WhatsApp Only' },
                  { id: 'voice_only', label: 'Voice Only' },
                  { id: 'combined', label: 'Combined (Omnichannel)' },
                ].map((cp) => (
                  <button
                    key={cp.id}
                    type="button"
                    onClick={() => setChannelPlan(cp.id as any)}
                    style={{
                      background: channelPlan === cp.id ? 'var(--surface2)' : 'var(--surface3)',
                      border: `var(--border-width) solid ${channelPlan === cp.id ? 'var(--accent)' : 'var(--border)'}`,
                      color: channelPlan === cp.id ? 'var(--text)' : 'var(--text3)',
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {cp.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)', marginBottom: 'var(--space-2)', display: 'block' }}>
                Brain Supply Mode (§9.5)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div
                  onClick={() => setBrainSupplyMode('byo')}
                  style={{
                    background: brainSupplyMode === 'byo' ? 'var(--surface2)' : 'var(--surface3)',
                    border: `var(--border-width) solid ${brainSupplyMode === 'byo' ? 'var(--green)' : 'var(--border)'}`,
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ color: 'var(--text)', fontSize: 'var(--text-sm)', display: 'block' }}>BYO Brain (Client Supplies Key)</strong>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text3)' }}>Client provides provider API keys; pays own inference directly.</span>
                </div>
                <div
                  onClick={() => setBrainSupplyMode('managed')}
                  style={{
                    background: brainSupplyMode === 'managed' ? 'var(--surface2)' : 'var(--surface3)',
                    border: `var(--border-width) solid ${brainSupplyMode === 'managed' ? 'var(--green)' : 'var(--border)'}`,
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ color: 'var(--text)', fontSize: 'var(--text-sm)', display: 'block' }}>Managed Brain (Kriya Hosted)</strong>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text3)' }}>Priced tier; inference billed with markup through Omnitask.</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Governance & Quotas */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Autonomy Ceiling</label>
                <select
                  value={autonomyCeiling}
                  onChange={(e) => setAutonomyCeiling(e.target.value as any)}
                  style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
                >
                  <option value="L1">L1 — Suggestion &amp; Human Approval Required</option>
                  <option value="L2">L2 — Bounded Autonomy (Default)</option>
                  <option value="L3">L3 — High Autonomy with Escalation</option>
                  <option value="L4">L4 — Full Autonomous Strategic Execution</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Monthly Spend Budget (₹ INR)</label>
                <input
                  type="number"
                  value={monthlyBudgetInr}
                  onChange={(e) => setMonthlyBudgetInr(parseInt(e.target.value, 10) || 1000)}
                  style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Max Concurrent Agent Tasks</label>
              <input
                type="number"
                value={maxConcurrentTasks}
                onChange={(e) => setMaxConcurrentTasks(parseInt(e.target.value, 10) || 1)}
                style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
              />
            </div>
          </div>
        )}

        {/* Step 5: Admin User Account */}
        {step === 5 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Client Admin Email *</label>
              <input
                type="email"
                required
                placeholder="admin@kaverimotors.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>Admin Full Name</label>
              <input
                type="text"
                placeholder="Rajesh Kumar"
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
                style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' }}
              />
            </div>
            <div>
              <label htmlFor="adminPassword" style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
                Initial Password (optional, 12+ characters; leave blank to auto-generate a strong one)
              </label>
              <input
                id="adminPassword"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Auto-generate"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                style={{ width: '100%', background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-2)', color: 'var(--text)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)' }}
              />
            </div>
          </div>
        )}

        {/* Step 6: Diff Review & Confirmation */}
        {step === 6 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{ background: 'var(--surface3)', border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text2)', maxHeight: '240px', overflow: 'auto' }}>
              <div style={{ color: 'var(--green)', fontWeight: 600 }}>+ TENANT RECORD DIFF TO BE WRITTEN:</div>
              <div>+ name: &quot;{name}&quot;</div>
              <div>+ slug: &quot;{slug}&quot;</div>
              <div>+ industry: &quot;{industry}&quot;</div>
              <div>+ region: &quot;{region}&quot;</div>
              <div>+ languages: [{languages.map((l) => `"${l}"`).join(', ')}]</div>
              <div>+ dna_profile: &quot;{dnaProfileId}&quot;</div>
              <div>+ channel_plan: &quot;{channelPlan}&quot;</div>
              <div>+ brain_supply_mode: &quot;{brainSupplyMode}&quot;</div>
              <div>+ autonomy_ceiling: &quot;{autonomyCeiling}&quot;</div>
              <div>+ quotas: &#123; max_concurrent: {maxConcurrentTasks}, budget: ₹{monthlyBudgetInr} &#125;</div>
              <div>+ admin_user: &quot;{adminEmail}&quot; ({adminFullName || `${name} Admin`})</div>
            </div>

            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
              <Icon name="alert" /> High-Risk Action: Writing this record establishes a new database boundary and immediately commits a cryptographic entry to the audit ledger.
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: 'var(--border-width) solid var(--border)',
            paddingTop: 'var(--space-3)',
            marginTop: 'var(--space-2)',
          }}
        >
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
            disabled={isSubmitting}
            style={{
              background: 'var(--surface2)',
              border: 'var(--border-width) solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-4)',
              color: 'var(--text)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>

          {step < 6 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && (!name || !slug)) {
                  setError('Please fill in business name and slug.');
                  return;
                }
                if (step === 1 && !SLUG_RE.test(slug)) {
                  setError('Workspace slug: lowercase letters, numbers and single hyphens only (e.g. sunrise-clinic).');
                  return;
                }
                if (step === 5 && !adminEmail) {
                  setError('Please specify admin email.');
                  return;
                }
                if (step === 5 && adminPassword && adminPassword.length < 12) {
                  setError('Initial password must be at least 12 characters, or leave it blank to auto-generate.');
                  return;
                }
                setError(null);
                setStep((s) => s + 1);
              }}
              style={{
                background: 'var(--surface2)',
                border: 'var(--border-width) solid var(--border2)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-4)',
                color: 'var(--text)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Next Step →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={isSubmitting}
              style={{
                background: 'var(--green)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-4)',
                color: '#0E141B',
                fontSize: 'var(--text-sm)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isSubmitting ? 'Provisioning...' : 'Confirm & Provision Tenant'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
