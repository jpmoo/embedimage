import { useEffect, useState } from 'react';
import { lanJson } from './imageProcessor';

// Polls the Mac /status endpoint to expose a coarse connection state to
// the UI's status dot. Each consumer screen creates its own hook instance;
// network use is tiny (small JSON every few seconds) and identity
// adjustments / capture polling are unaffected.
export type ConnStatus = 'unknown' | 'connected' | 'disconnected';

const POLL_MS = 5000;
const TIMEOUT_MS = 2000;

export function useConnStatus(baseUrl: string): ConnStatus {
  const [status, setStatus] = useState<ConnStatus>('unknown');

  useEffect(() => {
    if (!baseUrl) {
      setStatus('unknown');
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        await lanJson('GET', `${baseUrl}/status`, undefined, TIMEOUT_MS);
        if (alive) setStatus('connected');
      } catch {
        if (alive) setStatus('disconnected');
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [baseUrl]);

  return status;
}
