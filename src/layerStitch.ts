import { PluginCommAPI, PluginFileAPI, PluginManager } from 'sn-plugin-lib';
import { flattenOntoBg } from './imageProcessor';
import { FileLogger } from './util/FileLogger';

// Inkling/jpmoo-inspired: take the current lasso selection, optionally
// filter to a subset of note layers, render to a sticker via
// convertElement2Sticker, then rasterize that to a PNG via
// generateStickerThumbnail. Optionally flatten the (transparent)
// rasterization onto a solid background.

export type LayerInfo = {
  layerId: number;     // 0..3 user layers
  name: string;
  isCurrent: boolean;
  isVisible: boolean;
  count: number;       // # of lassoed elements on this layer
};

export type LassoSurvey = {
  notePath: string;
  page: number;
  rect: { left: number; top: number; right: number; bottom: number };
  layers: LayerInfo[];
  elementsByLayer: Map<number, any[]>;
};

export async function surveyLasso(): Promise<LassoSurvey | null> {
  const fpRes: any = await PluginCommAPI.getCurrentFilePath();
  const pgRes: any = await PluginCommAPI.getCurrentPageNum();
  const notePath = fpRes?.result ?? fpRes?.filePath ?? fpRes;
  const page = pgRes?.result ?? pgRes?.pageNum ?? pgRes;
  if (typeof notePath !== 'string' || typeof page !== 'number') return null;

  const rectRes: any = await PluginCommAPI.getLassoRect();
  if (!rectRes?.success || !rectRes.result) return null;
  const rect = rectRes.result;

  const elRes: any = await PluginCommAPI.getLassoElements();
  if (!elRes?.success || !Array.isArray(elRes.result)) return null;
  const elements: any[] = elRes.result;

  const elementsByLayer = new Map<number, any[]>();
  for (const el of elements) {
    const ln = (el?.layerNum ?? 0) as number;
    if (!elementsByLayer.has(ln)) elementsByLayer.set(ln, []);
    elementsByLayer.get(ln)!.push(el);
  }

  // Try getLayers first — gives us proper names + visibility. If it
  // fails or returns nothing usable, fall back to whatever layerNums
  // appear in the lasso so the user still has something to pick from.
  let rawLayers: any[] = [];
  try {
    const lyRes: any = await PluginFileAPI.getLayers(notePath, page);
    if (lyRes?.success && Array.isArray(lyRes.result)) {
      rawLayers = lyRes.result;
    }
    FileLogger.log('LayerStitch', 'getLayers ->', { success: lyRes?.success, n: rawLayers.length });
  } catch (e: any) {
    FileLogger.log('LayerStitch', 'getLayers threw', e?.message ?? String(e));
  }

  let layers: LayerInfo[] = rawLayers
    .map((l: any) => {
      const id = (l.layerId !== undefined ? l.layerId : l.layerNum) as number;
      return {
        layerId: id,
        name: typeof l.name === 'string' && l.name.length > 0 ? l.name : `Layer ${id + 1}`,
        isCurrent: !!l.isCurrentLayer,
        isVisible: l.isVisible !== false,
        count: elementsByLayer.get(id)?.length ?? 0,
      };
    })
    .filter((l) => l.layerId >= 0)
    .sort((a, b) => a.layerId - b.layerId);

  if (layers.length === 0) {
    // Fallback: infer layers from the lassoed elements' layerNums.
    // Always include layer 0 (main) so the user has at least one row.
    const ids = new Set<number>([0]);
    for (const ln of elementsByLayer.keys()) {
      if (ln >= 0) ids.add(ln);
    }
    layers = Array.from(ids)
      .sort((a, b) => a - b)
      .map((id) => ({
        layerId: id,
        name: `Layer ${id + 1}`,
        isCurrent: id === 0,
        isVisible: true,
        count: elementsByLayer.get(id)?.length ?? 0,
      }));
    FileLogger.log('LayerStitch', 'using inferred layers', { ids: Array.from(ids) });
  }

  FileLogger.log('LayerStitch', 'surveyLasso', {
    notePath, page, rect, layerCount: layers.length, totalEls: elements.length,
    elementsByLayer: Object.fromEntries(
      Array.from(elementsByLayer.entries()).map(([k, v]) => [k, v.length]),
    ),
  });

  return { notePath, page, rect, layers, elementsByLayer };
}

export type ComposeOpts = {
  selectedLayerIds: number[];
  transparentBg: boolean;
};

// Produce a PNG that contains only elements from `selectedLayerIds`
// (within the current lasso). Returns the absolute file path. The
// caller is responsible for inserting/sending.
export async function composeLassoLayers(
  survey: LassoSurvey, opts: ComposeOpts,
): Promise<string> {
  const pluginDir = await PluginManager.getPluginDirPath();
  if (!pluginDir) throw new Error('cannot resolve plugin directory');
  const trimmed = pluginDir.replace(/\/+$/, '');
  const stamp = Date.now();
  const stickerPath = `${trimmed}/layerstitch-${stamp}.sticker`;
  const pngPath = `${trimmed}/layerstitch-${stamp}.png`;

  const wanted = new Set(opts.selectedLayerIds);
  const picked: any[] = [];
  for (const [layerId, els] of survey.elementsByLayer.entries()) {
    if (wanted.has(layerId)) picked.push(...els);
  }
  if (picked.length === 0) throw new Error('No elements selected (pick at least one layer with content)');

  FileLogger.log('LayerStitch', 'composing', {
    pickedCount: picked.length, layers: opts.selectedLayerIds, transparent: opts.transparentBg,
  });

  // Clear stale sticker file from a prior run so we don't overwrite a
  // locked handle.
  try { PluginCommAPI.clearElementCache(); } catch {}

  const deviceType = await PluginManager.getDeviceType().catch(() => 5);
  const convertRes: any = await PluginCommAPI.convertElement2Sticker({
    machineType: deviceType, elements: picked, stickerPath,
  });
  FileLogger.log('LayerStitch', 'convertElement2Sticker ->', convertRes);
  if (!convertRes?.success) {
    throw new Error(convertRes?.error?.message ?? 'convertElement2Sticker failed');
  }

  const sizeRes: any = await PluginCommAPI.getStickerSize(stickerPath);
  FileLogger.log('LayerStitch', 'getStickerSize ->', sizeRes);
  const size = sizeRes?.result;
  if (!size?.width || !size?.height) {
    throw new Error(`getStickerSize returned ${JSON.stringify(size)}`);
  }

  const thumbRes: any = await PluginCommAPI.generateStickerThumbnail(stickerPath, pngPath, size);
  FileLogger.log('LayerStitch', 'generateStickerThumbnail ->', thumbRes);
  if (thumbRes?.success === false) {
    throw new Error(thumbRes?.error?.message ?? 'generateStickerThumbnail failed');
  }

  if (opts.transparentBg) {
    return pngPath; // already has transparent BG (sticker renders so)
  }
  const flatPath = `${trimmed}/layerstitch-${stamp}-flat.png`;
  await flattenOntoBg(pngPath, flatPath, { r: 255, g: 255, b: 255 });
  FileLogger.log('LayerStitch', 'flattened ->', flatPath);
  return flatPath;
}

// Insert the composed PNG back at the lasso location. Uses
// PluginNoteAPI.insertImage (host picks default position) as the
// reliable fallback — we tried positioned insertElements earlier and
// it kept rejecting picture payloads.
export async function insertComposed(pngPath: string): Promise<void> {
  const { PluginNoteAPI } = await import('sn-plugin-lib');
  const res: any = await PluginNoteAPI.insertImage(pngPath);
  FileLogger.log('LayerStitch', 'insertImage ->', res);
  if (!res || res.success === false) {
    throw new Error(res?.error?.message ?? 'insertImage failed');
  }
  try { await PluginNoteAPI.saveCurrentNote(); } catch {}
}
