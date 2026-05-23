import { ImageProcessor } from './imageProcessor';
import { DEFAULT_STREAM_CONFIG, StreamConfig } from './types';

const STREAM_CONFIG_KEY = 'streamConfig';

export async function loadStreamConfig(): Promise<StreamConfig> {
  if (!ImageProcessor?.getConfigValue) return DEFAULT_STREAM_CONFIG;
  try {
    const raw = await ImageProcessor.getConfigValue(STREAM_CONFIG_KEY);
    if (!raw) return DEFAULT_STREAM_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      host: typeof parsed.host === 'string' ? parsed.host : '',
      port: typeof parsed.port === 'number' ? parsed.port : DEFAULT_STREAM_CONFIG.port,
      intervalSec:
        typeof parsed.intervalSec === 'number' ? parsed.intervalSec : DEFAULT_STREAM_CONFIG.intervalSec,
    };
  } catch {
    return DEFAULT_STREAM_CONFIG;
  }
}

export async function saveStreamConfig(cfg: StreamConfig): Promise<void> {
  if (!ImageProcessor?.setConfigValue) return;
  await ImageProcessor.setConfigValue(STREAM_CONFIG_KEY, JSON.stringify(cfg));
}

export function baseUrl(cfg: StreamConfig): string {
  const host = cfg.host.trim();
  if (!host) return '';
  return `http://${host}:${cfg.port}`;
}
