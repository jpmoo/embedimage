export type SortKey = 'date_desc' | 'date_asc' | 'name';
export type EntryKind = 'image' | 'folder';
export type Entry = { name: string; path: string; kind: EntryKind };
export type Screen = 'browser' | 'preview' | 'settings' | 'capture' | 'refresh' | 'sourcepicker';

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
  resolutionMul: number; // 0.1 .. 1.0, server downscales each frame
};

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  host: '',
  port: 9000,
  intervalSec: 1.0,
  resolutionMul: 1.0,
};

export type SourceKind = 'screen' | 'window' | 'region';
export type MacWindow = {
  id: number;
  owner: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type Region = { x: number; y: number; w: number; h: number };

export type EmbedTrack = {
  notePath: string;
  page: number;
  layerNum: number;
  numInPage: number;
  uuid: string;
  rect: { left: number; top: number; right: number; bottom: number };
};

export type LogEntry = { ts: number; msg: string };
