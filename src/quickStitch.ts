import { FileUtils, NativeUIUtils, PluginCommAPI, PluginManager, PluginNoteAPI } from 'sn-plugin-lib';
import { flattenOntoBg } from './imageProcessor';
import { FileLogger } from './util/FileLogger';

// Headless lasso → sticker → PNG, inserted into the note. Same
// pipeline jpmoo's lassoexport uses (which is the only one that
// reliably works for "save lasso as image"). Runs entirely from the
// button-press handler in index.js — no plugin view, no routing race.
//
// Two flavours exposed below: transparent background (drop straight in,
// nothing covers existing content) and white background (handy when
// pasting into a darker page or shipping to a viewer that doesn't
// handle alpha well).

async function exportLasso(transparentBg: boolean): Promise<string> {
  const pluginDir = await PluginManager.getPluginDirPath();
  if (!pluginDir) throw new Error('cannot resolve plugin directory');
  const trimmed = pluginDir.replace(/\/+$/, '');
  const stamp = Date.now();
  const stickerPath = `${trimmed}/qstitch-${stamp}.sticker`;
  const pngPath = `${trimmed}/qstitch-${stamp}.png`;
  const flatPath = `${trimmed}/qstitch-${stamp}-flat.png`;

  // Clean any leftover stickers from prior runs.
  try { PluginCommAPI.clearElementCache(); } catch {}
  try {
    const existing: any = await FileUtils.listFiles(pluginDir);
    if (Array.isArray(existing)) {
      for (const entry of existing) {
        const name = typeof entry === 'string' ? entry : entry?.path;
        if (typeof name === 'string' && name.endsWith('.sticker')) {
          try { await FileUtils.deleteFile(name.startsWith('/') ? name : `${trimmed}/${name}`); } catch {}
        }
      }
    }
  } catch {}

  FileLogger.raw('[embedimage] QuickStitch saveStickerByLasso ->', stickerPath);
  const saveRes: any = await PluginCommAPI.saveStickerByLasso(stickerPath);
  FileLogger.raw('[embedimage] QuickStitch saveStickerByLasso result:', JSON.stringify(saveRes));
  if (!saveRes?.success) {
    throw new Error(saveRes?.error?.message ?? 'saveStickerByLasso failed (lasso may be empty)');
  }

  const sizeRes: any = await PluginCommAPI.getStickerSize(stickerPath);
  FileLogger.raw('[embedimage] QuickStitch getStickerSize ->', JSON.stringify(sizeRes));
  const size = sizeRes?.result;
  if (!size?.width || !size?.height) {
    throw new Error(`getStickerSize returned ${JSON.stringify(size)}`);
  }

  const thumbRes: any = await PluginCommAPI.generateStickerThumbnail(stickerPath, pngPath, size);
  FileLogger.raw('[embedimage] QuickStitch generateStickerThumbnail ->', JSON.stringify(thumbRes));
  if (thumbRes?.success === false) {
    throw new Error(thumbRes?.error?.message ?? 'generateStickerThumbnail failed');
  }

  if (transparentBg) {
    try { await FileUtils.deleteFile(stickerPath); } catch {}
    return pngPath;
  }
  await flattenOntoBg(pngPath, flatPath, { r: 255, g: 255, b: 255 });
  try { await FileUtils.deleteFile(stickerPath); } catch {}
  return flatPath;
}

export async function runQuickStitch(transparentBg: boolean): Promise<void> {
  FileLogger.raw('[embedimage] runQuickStitch start', { transparentBg });
  try {
    const pngPath = await exportLasso(transparentBg);
    FileLogger.raw('[embedimage] runQuickStitch composed ->', pngPath);
    const ins: any = await PluginNoteAPI.insertImage(pngPath);
    FileLogger.raw('[embedimage] runQuickStitch insertImage ->', JSON.stringify(ins));
    if (!ins || ins.success === false) {
      throw new Error(ins?.error?.message ?? 'insertImage failed');
    }
    try { await PluginNoteAPI.saveCurrentNote(); } catch {}
    try {
      const ToastAndroid = require('react-native').ToastAndroid;
      ToastAndroid.show(
        `Stitched lasso (${transparentBg ? 'transparent' : 'white'} BG)`,
        ToastAndroid.LONG,
      );
    } catch {}
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    FileLogger.raw('[embedimage] runQuickStitch failed:', msg);
    try { NativeUIUtils.showRattaDialog(`Quick Stitch failed: ${msg}`, '', 'OK', false); } catch {}
  }
}
