import { useState } from 'react';
import { Link } from 'react-router';
import { apiFetch, ApiError } from '../../lib/apiClient';
import styles from './Conversations.module.css';

export function Conversations() {
  const [channel, setChannel] = useState<'whatsapp' | 'voice' | 'email' | 'sms'>('whatsapp');
  const [recipient, setRecipient] = useState<string>('');
  const [messageText, setMessageText] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSending(true);
      setActionError(null);
      setActionSuccess(null);

      const idempotencyKey = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const res = await apiFetch<{ status: string; messageId?: string }>('/api/v1/channels/send', {
        method: 'POST',
        body: JSON.stringify({
          channel,
          recipient,
          messageType: 'text',
          payload: { text: messageText },
          customerId: customerId.trim() || undefined,
          idempotencyKey,
        }),
      });

      setActionSuccess(`Message dispatched successfully via ${channel.toUpperCase()} (ID: ${res.messageId || 'queued'}).`);
      setMessageText('');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to send outbound message');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Channel Conversations & Outbound Dispatch</h1>
          <p className={styles.subtitle}>Multi-channel messaging connector, live agent dispatch, and interaction hubs.</p>
        </div>
      </header>

      {actionError && <div className={styles.errorBanner}>⚠️ {actionError}</div>}
      {actionSuccess && <div className={styles.successBanner}>✓ {actionSuccess}</div>}

      <div className={styles.grid}>
        {/* Outbound Dispatcher Form */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Test Outbound Message Dispatch</h2>
          <form className={styles.form} onSubmit={handleSendMessage}>
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="channel-select">Channel</label>
              <select
                id="channel-select"
                className={styles.select}
                value={channel}
                onChange={(e) => setChannel(e.target.value as any)}
              >
                <option value="whatsapp">WhatsApp (Meta Cloud API)</option>
                <option value="voice">Voice Call (Twilio/WebRTC)</option>
                <option value="email">Email (SMTP/SendGrid)</option>
                <option value="sms">SMS</option>
              </select>
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="recipient-input">Recipient (Phone or Email) *</label>
              <input
                id="recipient-input"
                type="text"
                required
                className={styles.input}
                placeholder="+14155552671 or user@example.com"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="customer-id-input">Linked Customer ID (Optional)</label>
              <input
                id="customer-id-input"
                type="text"
                className={styles.input}
                placeholder="Optional customer UUID to tie to 360 timeline"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              />
            </div>

            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="message-body-input">Message Content *</label>
              <textarea
                id="message-body-input"
                required
                className={styles.textarea}
                placeholder="Type outbound message or test payload..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
              />
            </div>

            <button type="submit" className={styles.btnPrimary} disabled={isSending}>
              {isSending ? 'Dispatching...' : 'Send Message'}
            </button>
          </form>
        </div>

        {/* Channel Status & Hub Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Channel Ingress & Status</h2>
            <div className={styles.channelList}>
              <div className={styles.channelItem}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-ink)' }}>WhatsApp Cloud API</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Webhook: <code>/api/v1/channels/whatsapp/webhook</code></div>
                </div>
                <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
              </div>

              <div className={styles.channelItem}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-ink)' }}>Voice WebRTC / SIP</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Full-duplex low-latency audio connector</div>
                </div>
                <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
              </div>

              <div className={styles.channelItem}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-ink)' }}>Email Gateway</div>
                  <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Transactional & marketing inbox router</div>
                </div>
                <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
              </div>
            </div>
          </div>

          <div className={styles.noticeBox}>
            <h4>Conversation History Architecture</h4>
            <p>
              Under Xylarc AI's sovereign architecture, conversation turns and agent dialogues are anchored directly to individual customer entities.
            </p>
            <p style={{ margin: 0 }}>
              To view full chronological multi-turn conversations and sentiment analysis, visit the <Link to="/app/customers" style={{ color: 'var(--color-signal)', fontWeight: 600 }}>Customer 360 Directory</Link>. For live conversation takeovers, visit the <Link to="/app/attention" style={{ color: 'var(--color-signal)', fontWeight: 600 }}>Human Attention Center</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
