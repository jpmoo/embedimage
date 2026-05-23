import { ImageProcessor } from '../imageProcessor';

// Inkling-inspired persistent logger. Every call still hits console.log
// (so adb logcat keeps working) but also appends to a flat file the user
// can pull with `adb pull /sdcard/EmbedImage/log.txt`. Crucial when the
// RN bridge dies before logcat catches up.
const LOG_FILE = '/sdcard/EmbedImage/log.txt';
const MAX_QUEUED = 200;

let queued: string[] = [];
let flushing = false;

function ts(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

async function flush(): Promise<void> {
  if (flushing || queued.length === 0) return;
  flushing = true;
  const batch = queued.join('\n');
  queued = [];
  try {
    if (ImageProcessor?.appendFile) {
      await ImageProcessor.appendFile(LOG_FILE, batch);
    }
  } catch {
    // best-effort; if /sdcard isn't writable we just lose this batch.
  } finally {
    flushing = false;
    if (queued.length > 0) flush();
  }
}

function enqueue(line: string) {
  queued.push(line);
  if (queued.length > MAX_QUEUED) queued = queued.slice(-MAX_QUEUED);
  // Fire-and-forget; we never want logging to block the caller.
  flush();
}

export const FileLogger = {
  path: LOG_FILE,

  log(tag: string, msg: string, extra?: any): void {
    const formatted = extra !== undefined
      ? `${ts()} [${tag}] ${msg} ${typeof extra === 'string' ? extra : safeStringify(extra)}`
      : `${ts()} [${tag}] ${msg}`;
    console.log(`[embedimage:${tag}]`, msg, extra ?? '');
    enqueue(formatted);
  },

  // Variadic drop-in for "this used to be console.log(a, b, c)".
  raw(...parts: any[]): void {
    console.log(...parts);
    const stringified = parts
      .map((p) => (typeof p === 'string' ? p : safeStringify(p)))
      .join(' ');
    enqueue(`${ts()} ${stringified}`);
  },
};

function safeStringify(obj: any): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > 800 ? s.slice(0, 800) + '…' : s;
  } catch {
    return String(obj);
  }
}
