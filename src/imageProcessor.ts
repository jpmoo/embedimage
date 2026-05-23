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
