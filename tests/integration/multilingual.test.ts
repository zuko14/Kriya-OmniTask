import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Multilingual System (Indic & Global Languages) REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_multi_test';
  const customerId = 'cust_multi_1';
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Multilingual Test Corp', 'multi-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    await client.execute(
      `INSERT OR IGNORE INTO customers (
        id, tenant_id, organization_id, primary_phone, full_name, lifecycle_stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [customerId, tenantId, 'default', '+919876543210', 'Rahul Sharma', 'lead', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_multi',
      tenantId,
      email: 'multiadmin@kriya.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should detect language, normalize Indic text, analyze sentiment, translate, and manage customer profile', async () => {
    // 1. Detect Language
    const detectRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multilingual/detect',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { text: 'bhai mujhe refund status janna hai' },
    });
    expect(detectRes.statusCode).toBe(200);
    const detect = detectRes.json();
    expect(detect.language).toBe('hinglish');
    expect(detect.isCodeSwitched).toBe(true);

    // 2. Normalize Text
    const normRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multilingual/normalize',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { text: 'plz  batao  dhanyawad !!!' },
    });
    expect(normRes.statusCode).toBe(200);
    expect(normRes.json().normalizedText).toBe('kripya batao dhanyavad !');

    // 3. Sentiment Analysis
    const sentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multilingual/sentiment',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { text: 'service bahut shandar aur badhiya hai' },
    });
    expect(sentRes.statusCode).toBe(200);
    expect(sentRes.json().sentiment).toBe('positive');

    // 4. Translate Text
    const transRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multilingual/translate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        text: 'welcome to our store',
        targetLanguage: 'hi',
      },
    });
    expect(transRes.statusCode).toBe(200);
    expect(transRes.json().translatedText).toContain('स्वागत');

    // 5. Update Customer Language Profile
    const updateProfRes = await app.inject({
      method: 'POST',
      url: '/api/v1/multilingual/profiles',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        customerId,
        primaryLanguage: 'hinglish',
        preferredScript: 'Latin',
        isCodeSwitched: true,
      },
    });
    expect(updateProfRes.statusCode).toBe(200);
    expect(updateProfRes.json().primary_language).toBe('hinglish');

    // 6. Get Profile
    const getProfRes = await app.inject({
      method: 'GET',
      url: `/api/v1/multilingual/profiles/${customerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getProfRes.statusCode).toBe(200);
    expect(getProfRes.json().customer_id).toBe(customerId);
  });
});
