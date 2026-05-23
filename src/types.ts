export type SortKey = 'date_desc' | 'date_asc' | 'name';
export type EntryKind = 'image' | 'folder';
export type Entry = { name: string; path: string; kind: EntryKind };
export type Screen = 'browser' | 'preview' | 'settings' | 'capture';

export type Adjustments = {
  fade: number;
  brightness: number;
  contrast: number;
  gamma: number;
};

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  fade: 0,
  brightness: 0,
  contrast: 0,
  gamma: 1.0,
};

export type StreamConfig = {
  host: string;
  port: number;
  intervalSec: number;
};

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  host: '',
  port: 9000,
  intervalSec: 1.0,
};

export type EmbedTrack = {
  notePath: string;
  page: number;
  layerNum: number;
  numInPage: number;
  uuid: string;
  rect: { left: number; top: number; right: number; bottom: number };
};

export type LogEntry = { ts: number; msg: string };
