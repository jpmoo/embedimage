import { PluginCommAPI, PluginFileAPI } from 'sn-plugin-lib';
import { FileLogger } from './util/FileLogger';

// Inkling-style lasso → text extraction. Picks up any selected handwritten
// strokes, runs the host's OCR (recognizeElements), and returns the
// recognized text plus a suggested insertion rect (below the last text
// box in the selection, if any, otherwise below the lasso itself).

export type RecognizeResult = {
  text: string;
  insertRect?: { left: number; top: number; right: number; bottom: number };
  stats: { strokes: number; textBoxes: number; pictures: number; others: number };
};

export async function recognizeLasso(): Promise<RecognizeResult> {
  const out: RecognizeResult = {
    text: '',
    stats: { strokes: 0, textBoxes: 0, pictures: 0, others: 0 },
  };

  const lassoRes: any = await PluginCommAPI.getLassoElements();
  FileLogger.log('Recognize', 'getLassoElements ->', { success: lassoRes?.success, count: Array.isArray(lassoRes?.result) ? lassoRes.result.length : 0 });
  if (!lassoRes?.success || !Array.isArray(lassoRes?.result)) {
    throw new Error(lassoRes?.error?.message ?? 'getLassoElements failed');
  }
  const elements: any[] = lassoRes.result;

  const strokes: any[] = [];
  const textParts: string[] = [];
  let lastTextBoxRect: { left: number; top: number; right: number; bottom: number } | undefined;

  for (const el of elements) {
    switch (el?.type) {
      case 0: // stroke
        out.stats.strokes++;
        strokes.push(el);
        break;
      case 500:
      case 501:
      case 502: { // text boxes
        out.stats.textBoxes++;
        const content: string = el.textBox?.textContentFull ?? '';
        if (content.trim()) textParts.push(content.trim());
        const r = el.textBox?.textRect;
        if (r && (!lastTextBoxRect || r.bottom > lastTextBoxRect.bottom)) {
          lastTextBoxRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
        break;
      }
      case 200:
        out.stats.pictures++;
        break;
      default:
        out.stats.others++;
        break;
    }
  }
  FileLogger.log('Recognize', `lasso stats`, out.stats);

  // OCR the handwritten strokes (if any) via the host's recognizer.
  if (strokes.length > 0) {
    try {
      const fpRes: any = await PluginCommAPI.getCurrentFilePath();
      const pgRes: any = await PluginCommAPI.getCurrentPageNum();
      const notePath = fpRes?.result ?? fpRes?.filePath ?? fpRes;
      const page = pgRes?.result ?? pgRes?.pageNum ?? pgRes;
      if (typeof notePath === 'string' && typeof page === 'number') {
        const psRes: any = await PluginFileAPI.getPageSize(notePath, page);
        FileLogger.log('Recognize', 'getPageSize ->', psRes);
        if (psRes?.success && psRes.result) {
          const ocr: any = await PluginCommAPI.recognizeElements(strokes, psRes.result);
          FileLogger.log('Recognize', 'recognizeElements ->', { success: ocr?.success, len: typeof ocr?.result === 'string' ? ocr.result.length : 0 });
          if (ocr?.success && typeof ocr.result === 'string' && ocr.result.trim()) {
            textParts.push(ocr.result.trim());
          }
        }
      }
    } catch (e: any) {
      FileLogger.log('Recognize', 'OCR threw', e?.message ?? String(e));
    }
  }

  out.text = textParts.join('\n');

  // Pick an insertion rect. Prefer right below the last text box; fall
  // back to right below the lasso bounding box.
  try {
    if (lastTextBoxRect) {
      out.insertRect = {
        left: lastTextBoxRect.left,
        top: lastTextBoxRect.bottom + 10,
        right: lastTextBoxRect.right,
        bottom: lastTextBoxRect.bottom + 90,
      };
    } else {
      const lr: any = await PluginCommAPI.getLassoRect();
      const r = lr?.result;
      if (r) {
        out.insertRect = {
          left: r.left, top: r.bottom + 10,
          right: r.right, bottom: r.bottom + 90,
        };
      }
    }
  } catch {
    // insertRect optional; caller can fall back.
  }

  return out;
}
