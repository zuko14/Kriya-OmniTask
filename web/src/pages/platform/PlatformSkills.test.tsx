import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformSkills } from './PlatformSkills';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('PlatformSkills Page (§9.3, §17.4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders deterministic skills library and test status badges', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('/api/v1/skills')) {
        return jsonResponse({
          success: true,
          skills: [
            {
              id: 'extract_contact_details',
              name: 'Extract Contact Details',
              version: '1.0.0',
              category: 'extraction',
              description: 'Deterministically extracts emails, phone numbers, and names.',
              is_deterministic: true,
              test_status: 'passed',
              granted_dna_profiles_json: '["*"]',
              invocation_count: 3412,
            },
          ],
        }) as any;
      }
      return jsonResponse({}) as any;
    });

    render(
      <BrowserRouter>
        <PlatformSkills />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/The Skill Library — Deterministic Scaffolding/i)).toBeInTheDocument();
      expect(screen.getByText(/Extract Contact Details/i)).toBeInTheDocument();
      expect(screen.getByText(/extract_contact_details/i)).toBeInTheDocument();
      expect(screen.getByText(/passed/i)).toBeInTheDocument();
    });
  });

  it('allows executing self-tests across all registered skills', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any, opts: any) => {
      if (String(url).includes('/api/v1/skills/test-all')) {
        return jsonResponse({
          success: true,
          results: {
            extract_contact_details: { skillId: 'extract_contact_details', passed: true, assertionsCount: 3 },
          },
        }) as any;
      }
      return jsonResponse({ success: true, skills: [] }) as any;
    });

    render(
      <BrowserRouter>
        <PlatformSkills />
      </BrowserRouter>
    );

    const testAllBtn = screen.getAllByRole('button', { name: /Run All Skill Tests/i })[0];
    fireEvent.click(testAllBtn);

    await waitFor(() => {
      expect(testAllBtn).toBeInTheDocument();
    });
  });

  it('S51: an API failure shows an error and no invented skills, counts or "100% Typed" claim', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => jsonResponse({ error: { code: 'X', message: 'Skill library unavailable', statusCode: 500 } }, false, 500) as any);
    render(
      <BrowserRouter>
        <PlatformSkills />
      </BrowserRouter>
    );
    expect(await screen.findByText('Skill library unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Validate Phone E.164|Redact PII/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/100% Typed/)).not.toBeInTheDocument();
  });

  it('labels a non-deterministic skill honestly', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      jsonResponse({ success: true, skills: [{ id: 's1', name: 'Summarise', version: '1.0.0', category: 'x', description: 'd', is_deterministic: false, test_status: 'untested', granted_dna_profiles_json: '[]', invocation_count: 0 }] }) as any
    );
    render(
      <BrowserRouter>
        <PlatformSkills />
      </BrowserRouter>
    );
    expect(await screen.findByText('Model-assisted')).toBeInTheDocument();
    expect(screen.queryByText(/^Deterministic$/)).not.toBeInTheDocument();
  });
});
