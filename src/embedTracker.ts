import { PluginCommAPI, PluginFileAPI, PluginNoteAPI } from 'sn-plugin-lib';
import { saveEmbedTrack } from './storage';
import { EmbedTrack } from './types';

// Tracks the most recently embedded Picture element so the live-capture
// flow can replace it in place when a new frame comes in.
//
// Flow on first insert:
//   1. insertImage(path) — uses the host's default position.
//   2. getLastElement() — picks up the new Picture element so we know its
//      uuid, numInPage, layerNum, and rect.
//   3. saveCurrentNote().
//
// Flow on replace:
//   1. getElements() and find ours by uuid — the rect may have moved if the
//      user dragged the lasso around in the meantime.
//   2. deleteElements([oldNumInPage]).
//   3. insertElements with a fresh Picture element at the same rect, layer.
//   4. getLastElement() again to refresh the tracker.
//   5. saveCurrentNote().

type ApiResponse<T = any> = { success: boolean; result?: T; error?: { code: number; message: string } };

async function getCurrentContext(): Promise<{ notePath: string; page: number } | null> {
  try {
    const pathRes: any = await PluginCommAPI.getCurrentFilePath();
    const pageRes: any = await PluginCommAPI.getCurrentPageNum();
    const notePath = pathRes?.result ?? pathRes?.filePath ?? pathRes;
    const page = pageRes?.result ?? pageRes?.pageNum ?? pageRes;
    if (typeof notePath !== 'string' || typeof page !== 'number') return null;
    return { notePath, page };
  } catch {
    return null;
  }
}

function fromElement(notePath: string, page: number, el: any): EmbedTrack | null {
  if (!el || !el.picture) return null;
  const rect = el.picture.rect;
  if (!rect) return null;
  return {
    notePath,
    page,
    layerNum: el.layerNum ?? 0,
    numInPage: el.numInPage ?? 0,
    uuid: el.uuid ?? '',
    rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
  };
}

export async function insertAndTrack(pngPath: string): Promise<EmbedTrack | null> {
  const res: ApiResponse = (await PluginNoteAPI.insertImage(pngPath)) as any;
  if (!res || res.success === false) {
    throw new Error(res?.error?.message ?? 'insertImage failed');
  }
  try {
    await PluginNoteAPI.saveCurrentNote();
  } catch {}
  const ctx = await getCurrentContext();
  if (!ctx) return null;
  let track: EmbedTrack | null = null;
  try {
    const lastRes: any = await PluginFileAPI.getLastElement();
    const el = lastRes?.result ?? lastRes;
    track = fromElement(ctx.notePath, ctx.page, el);
  } catch {
    track = null;
  }
  if (track) await saveEmbedTrack(track).catch(() => {});
  return track;
}

// Re-fetch the tracked element so we pick up any rect changes from the lasso.
async function refreshTrackRect(track: EmbedTrack): Promise<EmbedTrack> {
  if (!track.uuid) return track;
  try {
    const res: any = await PluginFileAPI.getElements(track.page, track.notePath);
    const list: any[] = res?.result ?? (Array.isArray(res) ? res : []);
    const found = list.find((e) => e?.uuid === track.uuid);
    if (!found) return track;
    const fresh = fromElement(track.notePath, track.page, found);
    return fresh ?? track;
  } catch {
    return track;
  }
}

export async function replaceInPlace(track: EmbedTrack, newPngPath: string): Promise<EmbedTrack | null> {
  const fresh = await refreshTrackRect(track);

  const elementBase = {
    type: 200, // Element.TYPE_PICTURE
    pageNum: fresh.page,
    layerNum: fresh.layerNum,
    picture: {
      picturePath: newPngPath,
      rect: { ...fresh.rect },
    },
  };

  // Preferred path: ask the SDK to modify the existing element in place.
  // This is atomic from the user's POV so a failure can never leave the
  // page with no embed (the previous bug was delete-then-insert: when
  // insert failed the user lost their image with nothing to show).
  let modifiedOk = false;
  try {
    const modElement = {
      ...elementBase,
      uuid: fresh.uuid,
      numInPage: fresh.numInPage,
    };
    const mod: any = await PluginFileAPI.modifyElements(
      fresh.notePath, fresh.page, [modElement as any],
    );
    if (mod && mod.success !== false) {
      const idxs: any[] = mod?.result ?? [];
      modifiedOk = Array.isArray(idxs) ? idxs.length > 0 : true;
    }
  } catch {
    modifiedOk = false;
  }

  // Fallback path: insert-then-delete. This way a failed insert leaves
  // the original embed untouched (the opposite of delete-then-insert).
  if (!modifiedOk) {
    try {
      const ins: any = await PluginFileAPI.insertElements(
        fresh.notePath, fresh.page, [elementBase as any],
      );
      if (ins && ins.success === false) {
        throw new Error(ins?.error?.message ?? 'insertElements failed');
      }
    } catch (e: any) {
      throw new Error(`insert failed (original embed kept): ${e?.message ?? e}`);
    }
    // Only delete the old one once the new one is safely in place.
    try {
      await PluginFileAPI.deleteElements(fresh.notePath, fresh.page, [fresh.numInPage]);
    } catch {
      // Non-fatal: user now has two pictures; better than zero.
    }
  }

  try {
    await PluginNoteAPI.saveCurrentNote();
  } catch {}

  let newTrack: EmbedTrack | null = null;
  try {
    const lastRes: any = await PluginFileAPI.getLastElement();
    const el = lastRes?.result ?? lastRes;
    newTrack = fromElement(fresh.notePath, fresh.page, el);
  } catch {
    newTrack = null;
  }
  // If modifyElements worked the uuid stays the same and getLastElement
  // may return a different element (e.g. an ink stroke added after);
  // fall back to the existing track so the next Replace still works.
  if (!newTrack && modifiedOk) newTrack = fresh;
  if (newTrack) await saveEmbedTrack(newTrack).catch(() => {});
  return newTrack;
}
