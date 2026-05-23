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

// Re-fetch the tracked element so we pick up any rect changes from the lasso,
// AND return the raw SDK element so callers can clone it verbatim. Picture
// elements have a bunch of fields (maxX, maxY, thickness, status,
// recognizeResult, ...) that the host validates on insertElements — we
// learned the hard way that omitting them gets HTTP 106 "Invalid API
// parameters".
async function refreshTrackAndRaw(
  track: EmbedTrack,
): Promise<{ track: EmbedTrack; raw: any | null }> {
  if (!track.uuid) return { track, raw: null };
  try {
    const res: any = await PluginFileAPI.getElements(track.page, track.notePath);
    const list: any[] = res?.result ?? (Array.isArray(res) ? res : []);
    const found = list.find((e) => e?.uuid === track.uuid);
    if (!found) return { track, raw: null };
    const fresh = fromElement(track.notePath, track.page, found);
    return { track: fresh ?? track, raw: found };
  } catch {
    return { track, raw: null };
  }
}

export async function replaceInPlace(track: EmbedTrack, newPngPath: string): Promise<EmbedTrack | null> {
  const { track: fresh, raw } = await refreshTrackAndRaw(track);
  console.log('[embedimage] replaceInPlace start', {
    notePath: fresh.notePath, page: fresh.page,
    numInPage: fresh.numInPage, layerNum: fresh.layerNum,
    uuid: fresh.uuid, rect: fresh.rect, newPngPath,
    rawKeys: raw ? Object.keys(raw) : null,
  });

  // Clone the existing element to keep maxX/maxY/thickness/layout fields
  // intact, but strip everything that describes the OLD picture's data
  // (uuid/numInPage are obvious; recognizeResult/status/contoursSrc/
  // angles are derived from the old picture and confuse the host).
  let newElement: any;
  if (raw) {
    newElement = JSON.parse(JSON.stringify(raw));
    for (const k of [
      'uuid', 'numInPage', 'recognizeResult', 'status',
      'contoursSrc', 'angles',
    ]) {
      delete newElement[k];
    }
    if (newElement.picture) {
      newElement.picture.picturePath = newPngPath;
      newElement.picture.rect = { ...fresh.rect };
    } else {
      newElement.picture = { picturePath: newPngPath, rect: { ...fresh.rect } };
    }
  } else {
    newElement = {
      type: 200,
      pageNum: fresh.page,
      layerNum: fresh.layerNum,
      picture: {
        picturePath: newPngPath,
        rect: { ...fresh.rect },
      },
    };
  }
  console.log('[embedimage] replaceInPlace newElement keys:', Object.keys(newElement));

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

  let movedTo: EmbedTrack | null = null;
  if (!insertOk) {
    // Fallback: use insertImage (host picks default position, but it
    // always works) then modifyElements to move the new picture to
    // fresh.rect. modifyElements doesn't re-load a picture's bitmap,
    // but it *does* honor rect updates, so this gives us refresh-in-
    // place even when insertElements rejects our payload shape.
    console.log('[embedimage] insertElements failed (', insertErr, ') — trying insertImage + move');
    const img: any = await PluginNoteAPI.insertImage(newPngPath);
    console.log('[embedimage] insertImage ->', JSON.stringify(img));
    if (!img || img.success === false) {
      throw new Error(`insert failed (original embed kept): ${img?.error?.message ?? insertErr ?? 'unknown'}`);
    }
    try { await PluginNoteAPI.saveCurrentNote(); } catch {}
    // Get the new picture's identity so we can move it.
    try {
      const lastRes: any = await PluginFileAPI.getLastElement();
      const newEl = lastRes?.result ?? lastRes;
      console.log('[embedimage] insertImage placed element:', JSON.stringify(newEl)?.slice(0, 300));
      if (newEl?.uuid && typeof newEl?.numInPage === 'number') {
        const moveEl: any = {
          ...newEl,
          picture: { ...(newEl.picture ?? {}), rect: { ...fresh.rect } },
        };
        const moveRes: any = await PluginFileAPI.modifyElements(
          fresh.notePath, fresh.page, [moveEl],
        );
        console.log('[embedimage] modifyElements (move) ->', JSON.stringify(moveRes));
        movedTo = fromElement(fresh.notePath, fresh.page, newEl);
      }
    } catch (e: any) {
      console.log('[embedimage] move-after-insertImage threw:', e?.message ?? e);
    }
  }

  try {
    const del: any = await PluginFileAPI.deleteElements(
      fresh.notePath, fresh.page, [fresh.numInPage],
    );
    console.log('[embedimage] deleteElements ->', JSON.stringify(del));
  } catch (e: any) {
    console.log('[embedimage] deleteElements threw:', e?.message ?? e);
    // Non-fatal: user has two pictures, better than zero.
  }

  try {
    await PluginNoteAPI.saveCurrentNote();
  } catch (e: any) {
    console.log('[embedimage] saveCurrentNote threw:', e?.message ?? e);
  }

  let newTrack: EmbedTrack | null = movedTo;
  if (!newTrack) {
    try {
      const lastRes: any = await PluginFileAPI.getLastElement();
      const el = lastRes?.result ?? lastRes;
      console.log('[embedimage] getLastElement after replace ->', JSON.stringify(el)?.slice(0, 400));
      newTrack = fromElement(fresh.notePath, fresh.page, el);
    } catch (e: any) {
      console.log('[embedimage] getLastElement threw:', e?.message ?? e);
      newTrack = null;
    }
  }
  if (newTrack) await saveEmbedTrack(newTrack).catch(() => {});
  return newTrack;
}
