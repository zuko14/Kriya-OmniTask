/**
 * Xylarc AI — WhatsApp Connector Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { WhatsAppConnector } from '../../src/channels/whatsapp/whatsappConnector.js';

describe('WhatsApp Connector Integration Tests', () => {
  it('should build text message payload adhering to Meta Cloud API specification', () => {
    const payload = WhatsAppConnector.buildTextMessage('+919876543210', 'Welcome to Xylarc AI!');
    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.to).toBe('+919876543210');
    expect(payload.type).toBe('text');
    expect((payload.text as any).body).toBe('Welcome to Xylarc AI!');
  });

  it('should build interactive quick-reply button message', () => {
    const payload = WhatsAppConnector.buildButtonMessage(
      '+919876543210',
      'Please select an option below:',
      [
        { id: 'btn_book', title: 'Book Demo' },
        { id: 'btn_support', title: 'Get Support' },
      ],
      'Xylarc Assistant',
      'Powered by Xylarc AI'
    );

    expect(payload.type).toBe('interactive');
    const interactive = payload.interactive as any;
    expect(interactive.type).toBe('button');
    expect(interactive.action.buttons.length).toBe(2);
    expect(interactive.action.buttons[0].reply.id).toBe('btn_book');
    expect(interactive.header.text).toBe('Xylarc Assistant');
  });

  it('should build interactive list message', () => {
    const payload = WhatsAppConnector.buildListMessage(
      '+919876543210',
      'Explore our available enterprise plans:',
      'View Plans',
      [
        {
          title: 'Workforce Plans',
          rows: [
            { id: 'plan_std', title: 'Standard Tier', description: 'Up to 3 Autonomous Agents' },
            { id: 'plan_pro', title: 'Professional Tier', description: 'Up to 10 Autonomous Agents' },
          ],
        },
      ]
    );

    expect(payload.type).toBe('interactive');
    const interactive = payload.interactive as any;
    expect(interactive.type).toBe('list');
    expect(interactive.action.sections[0].rows.length).toBe(2);
    expect(interactive.action.sections[0].rows[0].id).toBe('plan_std');
  });

  it('should parse inbound Meta webhook with incoming text and button replies', () => {
    const mockWebhook = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550234567', phone_number_id: '123456789' },
                contacts: [{ profile: { name: 'Amit Verma' }, wa_id: '919876543210' }],
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.HBgLMOTE5ODc2NTQzMjEwFQIAEhgWM0VCMDAwMDAwMDAwMDAwMDAwMDAwAA==',
                    timestamp: '1723680000',
                    type: 'text',
                    text: { body: 'Hello, I want to book a consultation' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const parsed = WhatsAppConnector.parseInboundWebhook(mockWebhook);
    expect(parsed.messages.length).toBe(1);
    expect(parsed.messages[0].from).toBe('919876543210');
    expect(parsed.messages[0].text).toBe('Hello, I want to book a consultation');
    expect(parsed.messages[0].type).toBe('text');
  });

  it('should parse inbound delivery status receipts', () => {
    const mockStatusWebhook = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                statuses: [
                  {
                    id: 'wamid.outbound123',
                    status: 'delivered',
                    timestamp: '1723680010',
                    recipient_id: '919876543210',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const parsed = WhatsAppConnector.parseInboundWebhook(mockStatusWebhook);
    expect(parsed.statuses.length).toBe(1);
    expect(parsed.statuses[0].messageId).toBe('wamid.outbound123');
    expect(parsed.statuses[0].status).toBe('delivered');
  });
});
