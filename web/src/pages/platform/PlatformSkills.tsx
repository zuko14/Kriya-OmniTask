import React, { useState, useEffect } from 'react';
import { MetricBlock } from '../../components/primitives/MetricBlock';
import { AsyncState } from '../../components/AsyncState';
import { apiFetch } from '../../lib/apiClient';
import styles from './PlatformSkills.module.css';

interface SkillRecord {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  is_deterministic: boolean;
  test_status: 'passed' | 'failed' | 'untested';
  last_tested_at?: string;
  granted_dna_profiles_json: string;
  invocation_count: number;
}

export const PlatformSkills: React.FC = () => {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingSkillId, setTestingSkillId] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [readAt, setReadAt] = useState<string | null>(null);

  useEffect(() => {
    fetchSkills();
  }, []);

  // Only what the API returns is shown; on failure the roster is empty with an error (never sample rows, S51).
  const fetchSkills = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ skills?: SkillRecord[] }>('/api/v1/skills');
      setSkills(data.skills ?? []);
      setLoadError(null);
      setReadAt(new Date().toLocaleTimeString());
    } catch (e) {
      setSkills([]);
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRunTest = async (skillId: string) => {
    setTestingSkillId(skillId);
    setActionError(null);
    try {
      await apiFetch(`/api/v1/skills/${encodeURIComponent(skillId)}/test`, { method: 'POST' });
    } catch (e) {
      setActionError(e);
    } finally {
      await fetchSkills();
      setTestingSkillId(null);
    }
  };

  const handleTestAll = async () => {
    setTestingAll(true);
    setActionError(null);
    try {
      await apiFetch('/api/v1/skills/test-all', { method: 'POST' });
    } catch (e) {
      setActionError(e);
    } finally {
      await fetchSkills();
      setTestingAll(false);
    }
  };

  const passingCount = skills.filter((s) => s.test_status === 'passed').length;
  const totalInvocations = skills.reduce((sum, s) => sum + (s.invocation_count || 0), 0);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>The Skill Library — Deterministic Scaffolding (§9.3, §17.4)</h1>
          <p className={styles.subtitle}>
            Versioned, unit-tested deterministic procedures executed by the body. Zero-token cost, reproducible logic, and strict schema gating.
          </p>
        </div>
        <button className="btn btn-accent" onClick={handleTestAll} disabled={testingAll}>
          {testingAll ? 'Running Self-Tests...' : 'Run All Skill Tests (§9.3)'}
        </button>
      </header>

      <div className={styles.metricsGrid}>
        {readAt && (
          <>
            <MetricBlock label="Registered skills" value={skills.length.toString()} source="skill_library" timestamp={`read ${readAt}`} />
            <MetricBlock label="Passing self-tests" value={`${passingCount}/${skills.length}`} source="skill_library · last test run" timestamp={`read ${readAt}`} />
            <MetricBlock label="Recorded invocations" value={totalInvocations.toLocaleString()} source="skill_library" timestamp={`read ${readAt}`} />
          </>
        )}
      </div>

      <div className={styles.sectionCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className={styles.sectionTitle}>Skill Library Roster</h2>
          <span style={{ fontSize: '12px', color: 'var(--text2)' }}>
            Failing skills cannot be granted to any agent or DNA profile
          </span>
        </div>

        {actionError !== null && <AsyncState status="error" error={actionError} />}
        {loading && <AsyncState status="loading" />}
        {!loading && loadError !== null && <AsyncState status="error" error={loadError} />}
        {!loading && loadError === null && skills.length === 0 && <AsyncState status="empty" emptyMessage="No skills registered." />}
        <div className={styles.tableWrapper}>
          <table className={styles.skillsTable}>
            <thead>
              <tr>
                <th>Skill Identifier</th>
                <th>Category</th>
                <th>Description</th>
                <th>Version</th>
                <th>Scaffolding Type</th>
                <th>Test Status</th>
                <th>Invocations</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id}>
                  <td>
                    <strong>{skill.name}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--text2)' }}>
                      <code>{skill.id}</code>
                    </div>
                  </td>
                  <td>
                    <span className={styles.categoryPill}>{skill.category}</span>
                  </td>
                  <td style={{ maxWidth: '280px', fontSize: '12px', color: 'var(--text2)' }}>
                    {skill.description}
                  </td>
                  <td>
                    <code>v{skill.version}</code>
                  </td>
                  <td>
                    <span className={`badge badge-sm ${skill.is_deterministic ? 'badge-blue' : 'badge-muted'}`}>
                      {skill.is_deterministic ? 'Deterministic' : 'Model-assisted'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        skill.test_status === 'passed'
                          ? styles.badgePassed
                          : skill.test_status === 'failed'
                          ? styles.badgeFailed
                          : styles.badgeUntested
                      }`}
                    >
                      {skill.test_status}
                    </span>
                  </td>
                  <td>{skill.invocation_count?.toLocaleString() || 0}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleRunTest(skill.id)}
                      disabled={testingSkillId === skill.id}
                    >
                      {testingSkillId === skill.id ? 'Testing...' : 'Run Test'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
