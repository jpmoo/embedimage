import { FileUtils, NativeUIUtils, PluginCommAPI, PluginManager } from 'sn-plugin-lib';
import { lanPostFile } from './imageProcessor';
import { baseUrl, loadStreamConfig } from './storage';
import { FileLogger } from './util/FileLogger';

// Cribbed from jpmoo/lassoexport. The reliable lasso → PNG pipeline:
//   PluginCommAPI.saveStickerByLasso(stickerPath)
//   PluginCommAPI.getStickerSize(stickerPath) -> {width, height}
//   PluginCommAPI.generateStickerThumbnail(stickerPath, pngPath, size)
// `.sticker` is the host's internal lasso archive; the thumbnail call
// rasterizes it to a PNG we can read like any other file.
//
// We then upload that PNG to the Mac's /sketch endpoint. The Mac decides
// whether to save as PNG or JPEG based on the ?format=… query string.

function unwrap<T>(value: any, what: string): T {
  if (!value || value.success === false) {
    const msg = value?.error?.message ?? `${what} failed`;
    throw new Error(msg);
  }
  return value.result as T;
}

function deriveBaseName(notePath: string): string {
  const last = notePath.split('/').pop() || 'note';
  const noExt = last.replace(/\.[^.]+$/, '');
  const safe = noExt.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe.length > 0 ? safe : 'note';
}

async function exportLassoToPng(): Promise<string> {
  const pluginDir = await PluginManager.getPluginDirPath();
  if (!pluginDir) throw new Error('cannot resolve plugin directory');
  const trimmedPlugin = pluginDir.replace(/\/+$/, '');

  // Clear stale lasso data and any leftover .sticker files from prior runs.
  try { PluginCommAPI.clearElementCache(); } catch {}
  try {
    const existing: any = await FileUtils.listFiles(pluginDir);
    if (Array.isArray(existing)) {
      for (const entry of existing) {
        const name = typeof entry === 'string' ? entry : entry?.path;
        if (typeof name === 'string' && name.endsWith('.sticker')) {
          try { await FileUtils.deleteFile(name.startsWith('/') ? name : `${trimmedPlugin}/${name}`); } catch {}
        }
      }
    }
  } catch {}

  let baseName = 'note';
  try {
    const notePath = unwrap<string>(await PluginCommAPI.getCurrentFilePath(), 'getCurrentFilePath');
    baseName = deriveBaseName(notePath);
  } catch {}

  const stamp = Date.now();
  const stickerPath = `${trimmedPlugin}/sticker-${stamp}.sticker`;
  const pngPath = `${trimmedPlugin}/lasso-${baseName}-${stamp}.png`;

  FileLogger.raw('[embedimage] exportLassoToPng saveStickerByLasso ->', stickerPath);
  unwrap(await PluginCommAPI.saveStickerByLasso(stickerPath), 'saveStickerByLasso');
  if (!(await FileUtils.exists(stickerPath))) {
    throw new Error('sticker file was not written (lasso may be empty)');
  }

  const size = unwrap<{ width: number; height: number }>(
    await PluginCommAPI.getStickerSize(stickerPath),
    'getStickerSize',
  );
  if (!size?.width || !size?.height) {
    throw new Error(`getStickerSize returned ${JSON.stringify(size)}`);
  }
  FileLogger.raw('[embedimage] exportLassoToPng size=', size);

  unwrap(
    await PluginCommAPI.generateStickerThumbnail(stickerPath, pngPath, size),
    'generateStickerThumbnail',
  );
  if (!(await FileUtils.exists(pngPath))) {
    throw new Error('PNG was not written');
  }

  // Drop the .sticker; we only needed the PNG.
  try { await FileUtils.deleteFile(stickerPath); } catch {}

  return pngPath;
}

export type LassoFormat = 'png' | 'jpg';

// Headless entry point — runs from index.js with no view opening.
// Reports progress + result via Android Toast and an error dialog so
// the user gets feedback without a React surface.
export async function runSendLassoToMac(format: LassoFormat = 'png'): Promise<void> {
  FileLogger.raw('[embedimage] runSendLassoToMac start format=', format);
  try {
    const cfg = await loadStreamConfig();
    const url = baseUrl(cfg);
    if (!url) {
      try { NativeUIUtils.showRattaDialog('No Mac server set.\nOpen Embed Image → Settings.', '', 'OK', false); } catch {}
      return;
    }

    const pngPath = await exportLassoToPng();
    FileLogger.raw('[embedimage] runSendLassoToMac pngPath=', pngPath);

    // Filename extension drives format selection on the Mac side.
    const baseStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `manta_${baseStamp}.${format}`;
    const qs = `?name=${encodeURIComponent(name)}&format=${format}`;
    const url2 = `${url}/sketch${qs}`;
    FileLogger.raw('[embedimage] runSendLassoToMac POST', url2);
    await lanPostFile(url2, pngPath, 'image/png', 30000);
    FileLogger.raw('[embedimage] runSendLassoToMac done');

    try {
      const ToastAndroid = require('react-native').ToastAndroid;
      ToastAndroid.show(`Sent to Mac as ${name}`, ToastAndroid.LONG);
    } catch {}
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    FileLogger.raw('[embedimage] runSendLassoToMac failed:', msg);
    try { NativeUIUtils.showRattaDialog(`Send failed: ${msg}`, '', 'OK', false); } catch {}
  }
}
