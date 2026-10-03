/**
 * Kriya AI — Meta WhatsApp Cloud API Connector
 * Native builder and parser for WhatsApp Business API messages (§7, §27 of CLAUDE.md).
 */

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
}

export interface WhatsAppButton {
  id: string;
  title: string;
}

export interface WhatsAppListSection {
  title: string;
  rows: Array<{
    id: string;
    title: string;
    description?: string;
  }>;
}

export interface InboundWhatsAppMessage {
  from: string; // sender phone
  messageId: string;
  timestamp: string;
  type: 'text' | 'button_reply' | 'list_reply' | 'image' | 'audio' | 'document' | 'unknown';
  text?: string;
  buttonId?: string;
  buttonTitle?: string;
  listId?: string;
  listTitle?: string;
  mediaUrl?: string;
  rawPayload: unknown;
}

export interface InboundWhatsAppStatus {
  messageId: string;
  recipientId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  error?: {
    code: number;
    title: string;
    message: string;
  };
}

export class WhatsAppConnector {
  /**
   * Builds a standard text message payload.
   */
  public static buildTextMessage(to: string, body: string, previewUrl = false): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: previewUrl,
        body,
      },
    };
  }

  /**
   * Builds an interactive quick-reply button message (up to 3 buttons).
   */
  public static buildButtonMessage(
    to: string,
    bodyText: string,
    buttons: WhatsAppButton[],
    headerText?: string,
    footerText?: string
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: {
              id: b.id,
              title: b.title.slice(0, 20),
            },
          })),
        },
      },
    };

    if (headerText) {
      (payload.interactive as any).header = { type: 'text', text: headerText };
    }
    if (footerText) {
      (payload.interactive as any).footer = { text: footerText };
    }

    return payload;
  }

  /**
   * Builds an interactive list menu message.
   */
  public static buildListMessage(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: WhatsAppListSection[],
    headerText?: string,
    footerText?: string
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText.slice(0, 20),
          sections: sections.map((s) => ({
            title: s.title.slice(0, 24),
            rows: s.rows.map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              description: r.description ? r.description.slice(0, 72) : undefined,
            })),
          })),
        },
      },
    };

    if (headerText) {
      (payload.interactive as any).header = { type: 'text', text: headerText };
    }
    if (footerText) {
      (payload.interactive as any).footer = { text: footerText };
    }

    return payload;
  }

  /**
   * Builds a template message payload.
   */
  public static buildTemplateMessage(
    to: string,
    templateName: string,
    languageCode = 'en',
    components: unknown[] = []
  ): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };
  }

  /**
   * Parses an inbound Meta WhatsApp webhook payload into typed messages and statuses.
   */
  public static parseInboundWebhook(payload: any): {
    messages: InboundWhatsAppMessage[];
    statuses: InboundWhatsAppStatus[];
  } {
    const messages: InboundWhatsAppMessage[] = [];
    const statuses: InboundWhatsAppStatus[] = [];

    if (!payload || !payload.entry || !Array.isArray(payload.entry)) {
      return { messages, statuses };
    }

    for (const entry of payload.entry) {
      if (!entry.changes || !Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        const value = change.value;
        if (!value || value.messaging_product !== 'whatsapp') continue;

        // Parse Inbound Messages
        if (value.messages && Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            let parsedType: InboundWhatsAppMessage['type'] = 'unknown';
            let text: string | undefined;
            let buttonId: string | undefined;
            let buttonTitle: string | undefined;
            let listId: string | undefined;
            let listTitle: string | undefined;

            if (msg.type === 'text' && msg.text) {
              parsedType = 'text';
              text = msg.text.body;
            } else if (msg.type === 'interactive' && msg.interactive) {
              if (msg.interactive.type === 'button_reply' && msg.interactive.button_reply) {
                parsedType = 'button_reply';
                buttonId = msg.interactive.button_reply.id;
                buttonTitle = msg.interactive.button_reply.title;
                text = buttonTitle;
              } else if (msg.interactive.type === 'list_reply' && msg.interactive.list_reply) {
                parsedType = 'list_reply';
                listId = msg.interactive.list_reply.id;
                listTitle = msg.interactive.list_reply.title;
                text = listTitle;
              }
            } else if (msg.type === 'image') {
              parsedType = 'image';
            } else if (msg.type === 'audio') {
              parsedType = 'audio';
            } else if (msg.type === 'document') {
              parsedType = 'document';
            }

            messages.push({
              from: msg.from,
              messageId: msg.id,
              timestamp: msg.timestamp,
              type: parsedType,
              text,
              buttonId,
              buttonTitle,
              listId,
              listTitle,
              rawPayload: msg,
            });
          }
        }

        // Parse Inbound Delivery Statuses
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const st of value.statuses) {
            statuses.push({
              messageId: st.id,
              recipientId: st.recipient_id,
              status: st.status,
              timestamp: st.timestamp,
              error: st.errors && st.errors[0] ? {
                code: st.errors[0].code,
                title: st.errors[0].title,
                message: st.errors[0].message,
              } : undefined,
            });
          }
        }
      }
    }

    return { messages, statuses };
  }
}
