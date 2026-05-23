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
  console.log('[embedimage] replaceInPlace start', {
    notePath: fresh.notePath, page: fresh.page,
    numInPage: fresh.numInPage, layerNum: fresh.layerNum,
    uuid: fresh.uuid, rect: fresh.rect, newPngPath,
  });

  const newElement: any = {
    type: 200, // Element.TYPE_PICTURE
    pageNum: fresh.page,
    layerNum: fresh.layerNum,
    picture: {
      picturePath: newPngPath,
      rect: { ...fresh.rect },
    },
  };

  // Insert the new picture FIRST. We learned the hard way that the
  // opposite order (delete then insert) can leave the user with no
  // embed at all if the insert step silently fails. We also avoid the
  // modifyElements path entirely — the SDK accepted it on 0.7.4 logs
  // but the displayed picture never repainted (the renderer caches the
  // bitmap by element identity and a path-only change doesn't
  // invalidate that cache).
  let insertOk = false;
  let insertErr: any = null;
  try {
    const ins: any = await PluginFileAPI.insertElements(
      fresh.notePath, fresh.page, [newElement],
    );
    console.log('[embedimage] insertElements ->', JSON.stringify(ins));
    if (ins && ins.success !== false) {
      insertOk = true;
    } else {
      insertErr = ins?.error?.message ?? 'insertElements rejected';
    }
  } catch (e: any) {
    insertErr = e?.message ?? String(e);
    console.log('[embedimage] insertElements threw:', insertErr);
  }

  if (!insertOk) {
    // Fallback: insertImage uses the host's default position so we
    // lose the rect, but the user at least sees a fresh frame. They
    // can re-position with the lasso afterwards.
    console.log('[embedimage] insertElements failed (', insertErr, ') — falling back to insertImage');
    const img: any = await PluginNoteAPI.insertImage(newPngPath);
    console.log('[embedimage] insertImage ->', JSON.stringify(img));
    if (!img || img.success === false) {
      throw new Error(`insert failed (original embed kept): ${img?.error?.message ?? insertErr ?? 'unknown'}`);
    }
  }

  // Only delete the old embed now that something has been re-inserted.
  try {
    const del: any = await PluginFileAPI.deleteElements(
      fresh.notePath, fresh.page, [fresh.numInPage],
    );
    console.log('[embedimage] deleteElements ->', JSON.stringify(del));
  } catch (e: any) {
    console.log('[embedimage] deleteElements threw:', e?.message ?? e);
    // Non-fatal: user now sees two pictures, better than zero.
  }

  try {
    await PluginNoteAPI.saveCurrentNote();
  } catch (e: any) {
    console.log('[embedimage] saveCurrentNote threw:', e?.message ?? e);
  }

  let newTrack: EmbedTrack | null = null;
  try {
    const lastRes: any = await PluginFileAPI.getLastElement();
    const el = lastRes?.result ?? lastRes;
    console.log('[embedimage] getLastElement after replace ->', JSON.stringify(el)?.slice(0, 400));
    newTrack = fromElement(fresh.notePath, fresh.page, el);
  } catch (e: any) {
    console.log('[embedimage] getLastElement threw:', e?.message ?? e);
    newTrack = null;
  }
  if (newTrack) await saveEmbedTrack(newTrack).catch(() => {});
  return newTrack;
}
