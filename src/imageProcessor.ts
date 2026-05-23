import { NativeModules } from 'react-native';
import type { Adjustments } from './types';

type ImageProcessorNative = {
  processForEmbed: (
    inputPath: string,
    whiteAlpha: number,
    brightness: number,
    contrast: number,
    gamma: number,
    previewMaxDim: number,
  ) => Promise<string>;
  downloadAndProcess: (
    url: string,
    whiteAlpha: number,
    brightness: number,
    contrast: number,
    gamma: number,
    previewMaxDim: number,
    timeoutMs: number,
  ) => Promise<string>;
  // Cleartext-safe HTTP for LAN endpoints. Bypasses Android's
  // NetworkSecurityPolicy (the pluginhost blocks our JS fetch()).
  nativeHttp: (
    method: string,
    url: string,
    bodyJson: string | null,
    timeoutMs: number,
  ) => Promise<{ status: number; body: string }>;
  nativeHttpPostFile: (
    url: string,
    inputPath: string,
    contentType: string,
    timeoutMs: number,
  ) => Promise<string>;
  cleanupCache: () => Promise<number>;
  getConfigValue: (key: string) => Promise<string | null>;
  setConfigValue: (key: string, value: string | null) => Promise<boolean>;
};

const native = (NativeModules as { ImageProcessor?: ImageProcessorNative }).ImageProcessor;

export const ImageProcessor = native;

export function adjustmentsAreDefault(a: Adjustments): boolean {
  return (
    a.fade === 0 &&
    a.brightness === 0 &&
    a.contrast === 0 &&
    Math.abs(a.gamma - 1.0) < 1e-6
  );
}

export async function bakeFile(
  inputPath: string,
  a: Adjustments,
  previewMaxDim: number,
): Promise<string> {
  if (!native) throw new Error('ImageProcessor native module missing');
  return native.processForEmbed(
    inputPath,
    a.fade / 100,
    a.brightness,
    a.contrast,
    a.gamma,
    previewMaxDim,
  );
}

export async function downloadAndBake(
  url: string,
  a: Adjustments,
  previewMaxDim: number,
  timeoutMs: number = 5000,
): Promise<string> {
  if (!native) throw new Error('ImageProcessor native module missing');
  return native.downloadAndProcess(
    url,
    a.fade / 100,
    a.brightness,
    a.contrast,
    a.gamma,
    previewMaxDim,
    timeoutMs,
  );
}

export async function lanHttp(
  method: 'GET' | 'POST',
  url: string,
  body?: object,
  timeoutMs: number = 3000,
): Promise<{ status: number; body: string }> {
  if (!native) throw new Error('ImageProcessor native module missing');
  return native.nativeHttp(method, url, body ? JSON.stringify(body) : null, timeoutMs);
}

export async function lanJson<T = any>(
  method: 'GET' | 'POST',
  url: string,
  body?: object,
  timeoutMs: number = 3000,
): Promise<T> {
  const res = await lanHttp(method, url, body, timeoutMs);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body) as T;
}

// POST a local file's bytes to a URL and save the binary response to a
// new cache file. Returns the output file path.
export async function lanPostFile(
  url: string,
  inputPath: string,
  contentType: string = 'image/png',
  timeoutMs: number = 60000,
): Promise<string> {
  if (!native) throw new Error('ImageProcessor native module missing');
  return native.nativeHttpPostFile(url, inputPath, contentType, timeoutMs);
}
