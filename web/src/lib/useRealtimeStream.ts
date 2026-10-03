import { useState, useEffect, useRef } from 'react';
import { RealtimeStreamClient, RealtimeEventEnvelope } from './realtimeClient';

export interface UseRealtimeStreamResult {
  events: RealtimeEventEnvelope[];
  agentStates: Record<string, any>;
  isConnected: boolean;
  isReconnecting: boolean;
  error?: string;
  client: RealtimeStreamClient | null;
}

export function useRealtimeStream(tenantId: string): UseRealtimeStreamResult {
  const [events, setEvents] = useState<RealtimeEventEnvelope[]>([]);
  const [agentStates, setAgentStates] = useState<Record<string, any>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const clientRef = useRef<RealtimeStreamClient | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    const client = new RealtimeStreamClient({
      tenantId,
      onBatchRender: (newEvents, newStates) => {
        setEvents(newEvents);
        setAgentStates(newStates);
      },
      onStatusChange: (status) => {
        setIsConnected(status.isConnected);
        setIsReconnecting(status.isReconnecting);
        setError(status.error);
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [tenantId]);

  return {
    events,
    agentStates,
    isConnected,
    isReconnecting,
    error,
    client: clientRef.current,
  };
}
