/* eslint-disable react-native/no-inline-styles */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  GestureResponderEvent,
  Image,
  PanResponder,
  PanResponderGestureState,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PluginNoteAPI } from 'sn-plugin-lib';
import { composeStitch, ImageCrop, StitchImage, StitchParams } from '../imageProcessor';
import { theme } from '../ui/theme';
import { TitleBar, Win95Button, Win95InsetPanel } from '../ui/Win95';
import { FileLogger } from '../util/FileLogger';

// Ported from Laumss/Inkling's StitchEditor. Gesture math is verbatim
// (it's the meat); chrome is replaced with Win95 styling and the actual
// compositing runs through our ImageProcessor.composeStitch native call
// instead of the Inkling-private path.

const HEADER_H = 32; // our TitleBar is tighter than Inkling's 56
const CTRL_H = 110;
const PAD = 12;
const HANDLE_LEN = 40;
const HANDLE_THICK = 6;
const HIT_RADIUS = 40;
const MIN_VISIBLE = 0.05;

type DragEdge = {
  kind: 'edge';
  imageIndex: number;
  cropKey: keyof ImageCrop;
  oppositeKey: keyof ImageCrop;
  startVal: number;
  sign: number;
  pxPerUnit: number;
};
type DragBoth = {
  kind: 'both';
  cropKey: keyof ImageCrop;
  oppositeKey: keyof ImageCrop;
  startVal0: number;
  startVal1: number;
  sign: number;
  pxPerUnit0: number;
  pxPerUnit1: number;
};
type DragState = DragEdge | DragBoth;

type Layout = {
  scale: number;
  dispW: number;
  dispH: number;
  originX: number;
  originY: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
};

const DEFAULT_PARAMS: StitchParams = { direction: 'vertical', overlap: 100, topLayerIndex: 1 };
const DEFAULT_CROP: ImageCrop = { cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 };

export type StitchSession = {
  images: [StitchImage, StitchImage];
  params: StitchParams;
};

export function makeSession(a: StitchImage, b: StitchImage, override: Partial<StitchParams> = {}): StitchSession {
  return {
    images: [
      { ...a, crop: { ...DEFAULT_CROP, ...(a.crop ?? {}) } },
      { ...b, crop: { ...DEFAULT_CROP, ...(b.crop ?? {}) } },
    ],
    params: { ...DEFAULT_PARAMS, ...override },
  };
}

export function StitchEditor({
  session: initial,
  onCancel,
  onInserted,
}: {
  session: StitchSession;
  onCancel: () => void;
  onInserted: () => void;
}): React.JSX.Element {
  const screen = Dimensions.get('window');
  const previewH = screen.height - HEADER_H - CTRL_H - 60; // 60 = our action row

  const [images, setImages] = useState<StitchImage[]>(() =>
    initial.images.map((img) => ({ ...img, crop: { ...img.crop } })),
  );
  const [params, setParams] = useState<StitchParams>(() => ({ ...initial.params }));
  const [busy, setBusy] = useState(false);

  const imagesRef = useRef(images);
  const paramsRef = useRef(params);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { paramsRef.current = params; }, [params]);

  const layout: Layout | null = useMemo(() => {
    if (images.length < 2) return null;
    const dir = params.direction;
    const eff = images.map((img) => ({
      w: img.width * (1 - img.crop.cropLeft - img.crop.cropRight),
      h: img.height * (1 - img.crop.cropTop - img.crop.cropBottom),
    }));
    let totalW: number, totalH: number;
    if (dir === 'vertical') {
      totalW = Math.max(eff[0].w, eff[1].w);
      totalH = eff[0].h + eff[1].h - params.overlap;
    } else {
      totalW = eff[0].w + eff[1].w - params.overlap;
      totalH = Math.max(eff[0].h, eff[1].h);
    }
    const availW = screen.width - PAD * 2;
    const availH = previewH - PAD * 2;
    const scale = Math.min(availW / Math.max(totalW, 1), availH / Math.max(totalH, 1), 1);
    const dispW = totalW * scale;
    const dispH = totalH * scale;
    const originX = (screen.width - dispW) / 2;
    const originY = HEADER_H + (previewH - dispH) / 2;
    const rects = [
      { x: 0, y: 0, w: eff[0].w * scale, h: eff[0].h * scale },
      { x: 0, y: 0, w: eff[1].w * scale, h: eff[1].h * scale },
    ];
    if (dir === 'vertical') {
      rects[0].x = originX; rects[0].y = originY;
      rects[1].x = originX; rects[1].y = originY + eff[0].h * scale - params.overlap * scale;
    } else {
      rects[0].x = originX; rects[0].y = originY;
      rects[1].x = originX + eff[0].w * scale - params.overlap * scale; rects[1].y = originY;
    }
    return { scale, dispW, dispH, originX, originY, rects };
  }, [images, params, screen, previewH]);

  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  const dragRef = useRef<DragState | null>(null);
  const overlapStartRef = useRef(0);
  const dragKindRef = useRef<'edge' | 'both' | 'overlap' | null>(null);

  // Gesture handler — ported verbatim from Inkling.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !busy,
      onMoveShouldSetPanResponder: () => !busy,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        if (busy) return;
        const { pageX, pageY } = evt.nativeEvent;
        const lo = layoutRef.current;
        const imgs = imagesRef.current;
        const p = paramsRef.current;
        if (!lo || imgs.length < 2) return;

        const isVert = p.direction === 'vertical';
        const r0 = lo.rects[0];
        const r1 = lo.rects[1];
        const juncY = isVert ? (r0.y + r0.h + r1.y) / 2 : (r0.y + r0.h / 2);
        const juncX = isVert ? (r0.x + r0.w / 2) : (r0.x + r0.w + r1.x) / 2;

        type H = { x: number; y: number; type: 'outerAxis' | 'overlap' | 'perpShared';
          imgIdx?: number; hitEdge?: string; edge?: string };
        const allHandles: H[] = isVert ? [
          { x: r0.x + r0.w / 2, y: r0.y,        type: 'outerAxis', imgIdx: 0, hitEdge: 'top' },
          { x: r1.x + r1.w / 2, y: r1.y + r1.h, type: 'outerAxis', imgIdx: 1, hitEdge: 'bottom' },
          { x: juncX, y: juncY,                 type: 'overlap' },
          { x: lo.originX,            y: juncY, type: 'perpShared', edge: 'left' },
          { x: lo.originX + lo.dispW, y: juncY, type: 'perpShared', edge: 'right' },
        ] : [
          { x: r0.x,        y: r0.y + r0.h / 2,  type: 'outerAxis', imgIdx: 0, hitEdge: 'left' },
          { x: r1.x + r1.w, y: r1.y + r1.h / 2,  type: 'outerAxis', imgIdx: 1, hitEdge: 'right' },
          { x: juncX, y: juncY,                  type: 'overlap' },
          { x: juncX, y: lo.originY,             type: 'perpShared', edge: 'top' },
          { x: juncX, y: lo.originY + lo.dispH,  type: 'perpShared', edge: 'bottom' },
        ];

        let bestDist = HIT_RADIUS;
        let bestH: H | null = null;
        for (const h of allHandles) {
          const d = Math.hypot(pageX - h.x, pageY - h.y);
          if (d < bestDist) { bestDist = d; bestH = h; }
        }

        if (!bestH) {
          overlapStartRef.current = p.overlap;
          dragKindRef.current = 'overlap';
          dragRef.current = null;
          return;
        }

        if (bestH.type === 'overlap') {
          overlapStartRef.current = p.overlap;
          dragKindRef.current = 'overlap';
          dragRef.current = null;
        } else if (bestH.type === 'outerAxis') {
          const idx = bestH.imgIdx!;
          const hitEdge = bestH.hitEdge! as 'top' | 'bottom' | 'left' | 'right';
          const targetEdge =
            hitEdge === 'top' ? 'bottom' :
            hitEdge === 'bottom' ? 'top' :
            hitEdge === 'left' ? 'right' : 'left';
          const cropKey = `crop${cap(targetEdge)}` as keyof ImageCrop;
          const oppositeKey = `crop${cap(hitEdge)}` as keyof ImageCrop;
          const isVertAxis = hitEdge === 'top' || hitEdge === 'bottom';
          const sign = (hitEdge === 'top' || hitEdge === 'left') ? 1 : -1;
          const imgPixelSize = isVertAxis ? imgs[idx].height : imgs[idx].width;
          dragRef.current = {
            kind: 'edge',
            imageIndex: idx,
            cropKey, oppositeKey,
            startVal: imgs[idx].crop[cropKey],
            sign,
            pxPerUnit: imgPixelSize * lo.scale,
          };
          dragKindRef.current = 'edge';
        } else {
          const edge = bestH.edge! as 'top' | 'bottom' | 'left' | 'right';
          const cropKey = `crop${cap(edge)}` as keyof ImageCrop;
          const oppositeEdge =
            edge === 'top' ? 'bottom' :
            edge === 'bottom' ? 'top' :
            edge === 'left' ? 'right' : 'left';
          const oppositeKey = `crop${cap(oppositeEdge)}` as keyof ImageCrop;
          const isVertAxis = edge === 'top' || edge === 'bottom';
          const sign = (edge === 'top' || edge === 'left') ? 1 : -1;
          dragRef.current = {
            kind: 'both',
            cropKey, oppositeKey,
            startVal0: imgs[0].crop[cropKey],
            startVal1: imgs[1].crop[cropKey],
            sign,
            pxPerUnit0: (isVertAxis ? imgs[0].height : imgs[0].width) * lo.scale,
            pxPerUnit1: (isVertAxis ? imgs[1].height : imgs[1].width) * lo.scale,
          };
          dragKindRef.current = 'both';
        }
      },

      onPanResponderMove: (_: GestureResponderEvent, g: PanResponderGestureState) => {
        if (busy) return;
        if (dragKindRef.current === 'edge' && dragRef.current?.kind === 'edge') {
          const d = dragRef.current;
          const img = imagesRef.current[d.imageIndex];
          if (!img) return;
          const isVertAxis = d.cropKey === 'cropTop' || d.cropKey === 'cropBottom';
          const screenDelta = isVertAxis ? g.dy : g.dx;
          const cropDelta = (d.sign * screenDelta) / d.pxPerUnit;
          const maxVal = 1 - MIN_VISIBLE - img.crop[d.oppositeKey];
          const newVal = Math.max(0, Math.min(maxVal, d.startVal + cropDelta));
          setImages((prev) => {
            const next = [...prev];
            next[d.imageIndex] = {
              ...next[d.imageIndex],
              crop: { ...next[d.imageIndex].crop, [d.cropKey]: newVal },
            };
            return next;
          });
        } else if (dragKindRef.current === 'both' && dragRef.current?.kind === 'both') {
          const d = dragRef.current;
          const imgs = imagesRef.current;
          const isVertAxis = d.cropKey === 'cropTop' || d.cropKey === 'cropBottom';
          const screenDelta = isVertAxis ? g.dy : g.dx;
          const delta0 = (d.sign * screenDelta) / d.pxPerUnit0;
          const delta1 = (d.sign * screenDelta) / d.pxPerUnit1;
          const max0 = 1 - MIN_VISIBLE - imgs[0].crop[d.oppositeKey];
          const max1 = 1 - MIN_VISIBLE - imgs[1].crop[d.oppositeKey];
          const v0 = Math.max(0, Math.min(max0, d.startVal0 + delta0));
          const v1 = Math.max(0, Math.min(max1, d.startVal1 + delta1));
          setImages((prev) => {
            const next = [...prev];
            next[0] = { ...next[0], crop: { ...next[0].crop, [d.cropKey]: v0 } };
            next[1] = { ...next[1], crop: { ...next[1].crop, [d.cropKey]: v1 } };
            return next;
          });
        } else if (dragKindRef.current === 'overlap') {
          const lo = layoutRef.current;
          const p = paramsRef.current;
          const imgs = imagesRef.current;
          if (!lo || imgs.length < 2) return;
          const isVert = p.direction === 'vertical';
          const screenDelta = isVert ? -g.dy : -g.dx;
          const imgDelta = screenDelta / lo.scale;
          const dim0 = isVert
            ? imgs[0].height * (1 - imgs[0].crop.cropTop - imgs[0].crop.cropBottom)
            : imgs[0].width * (1 - imgs[0].crop.cropLeft - imgs[0].crop.cropRight);
          const dim1 = isVert
            ? imgs[1].height * (1 - imgs[1].crop.cropTop - imgs[1].crop.cropBottom)
            : imgs[1].width * (1 - imgs[1].crop.cropLeft - imgs[1].crop.cropRight);
          const maxOvl = Math.min(dim0, dim1) * 0.8;
          const newOvl = Math.max(0, Math.min(maxOvl, overlapStartRef.current + imgDelta));
          setParams((prev) => ({ ...prev, overlap: Math.round(newOvl) }));
        }
      },
      onPanResponderRelease: () => { dragRef.current = null; dragKindRef.current = null; },
      onPanResponderTerminate: () => { dragRef.current = null; dragKindRef.current = null; },
    }),
  ).current;

  const toggleDirection = useCallback(() => {
    setParams((p) => ({
      ...p,
      direction: p.direction === 'vertical' ? 'horizontal' : 'vertical',
      overlap: Math.round(p.overlap * 0.5),
    }));
  }, []);
  const swapOrder = useCallback(() => setImages((prev) => [prev[1], prev[0]]), []);
  const toggleTopLayer = useCallback(() => {
    setParams((p) => ({ ...p, topLayerIndex: p.topLayerIndex === 0 ? 1 : 0 }));
  }, []);
  const adjustOverlap = useCallback((delta: number) => {
    setParams((p) => {
      const imgs = imagesRef.current;
      if (imgs.length < 2) return p;
      const dim0 = p.direction === 'vertical'
        ? imgs[0].height * (1 - imgs[0].crop.cropTop - imgs[0].crop.cropBottom)
        : imgs[0].width * (1 - imgs[0].crop.cropLeft - imgs[0].crop.cropRight);
      const dim1 = p.direction === 'vertical'
        ? imgs[1].height * (1 - imgs[1].crop.cropTop - imgs[1].crop.cropBottom)
        : imgs[1].width * (1 - imgs[1].crop.cropLeft - imgs[1].crop.cropRight);
      const maxOvl = Math.min(dim0, dim1) * 0.8;
      return { ...p, overlap: Math.max(0, Math.min(Math.round(maxOvl), p.overlap + delta)) };
    });
  }, []);

  const confirmCompose = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const outPath =
        `/data/user/0/com.ratta.supernote.pluginhost/cache/stitch_${Date.now()}.png`;
      FileLogger.raw('[embedimage] stitch compose start', {
        a: images[0].path, b: images[1].path, params,
      });
      await composeStitch(images[0], images[1], params, outPath);
      FileLogger.raw('[embedimage] stitch compose ok ->', outPath);
      const res: any = await PluginNoteAPI.insertImage(outPath);
      FileLogger.raw('[embedimage] stitch insertImage ->', JSON.stringify(res));
      if (!res || res.success === false) {
        throw new Error(res?.error?.message ?? 'insertImage failed');
      }
      try { await PluginNoteAPI.saveCurrentNote(); } catch {}
      onInserted();
    } catch (e: any) {
      FileLogger.raw('[embedimage] stitch failed:', e?.message ?? e);
      setBusy(false);
    }
  }, [busy, images, params, onInserted]);

  if (!layout) {
    return (
      <SafeAreaView style={styles.root}>
        <TitleBar title="STITCH.EXE" onClose={onCancel} />
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>Need two images to stitch.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isVert = params.direction === 'vertical';
  const drawOrder = params.topLayerIndex === 0 ? [1, 0] : [0, 1];

  const handles = computeHandles(layout, isVert);

  return (
    <SafeAreaView style={styles.root}>
      <TitleBar title="STITCH.EXE — Long Screenshot" onClose={onCancel} />

      <View style={[styles.preview, { height: previewH }]} {...pan.panHandlers}>
        <View
          style={[styles.compositeBorder, {
            left: layout.originX - 1,
            top: layout.originY - HEADER_H - 1,
            width: layout.dispW + 2,
            height: layout.dispH + 2,
          }]}
          pointerEvents="none"
        />

        {drawOrder.map((idx) => {
          const r = layout.rects[idx];
          const img = images[idx];
          const fullW = img.width * layout.scale;
          const fullH = img.height * layout.scale;
          const offsetL = img.crop.cropLeft * img.width * layout.scale;
          const offsetT = img.crop.cropTop * img.height * layout.scale;
          return (
            <View
              key={`img-clip-${idx}`}
              style={{
                position: 'absolute',
                left: r.x, top: r.y - HEADER_H,
                width: r.w, height: r.h,
                overflow: 'hidden',
              }}
            >
              <Image
                source={{ uri: `file://${img.path}` }}
                style={{ width: fullW, height: fullH, marginLeft: -offsetL, marginTop: -offsetT }}
                resizeMode="stretch"
              />
            </View>
          );
        })}

        {params.overlap > 0 && (
          <View
            style={[styles.overlapZone, isVert ? {
              left: layout.originX,
              top: layout.rects[1].y - HEADER_H,
              width: layout.dispW,
              height: Math.min(params.overlap * layout.scale, layout.rects[0].h),
            } : {
              left: layout.rects[1].x,
              top: layout.originY - HEADER_H,
              width: Math.min(params.overlap * layout.scale, layout.rects[0].w),
              height: layout.dispH,
            }]}
            pointerEvents="none"
          />
        )}

        {[0, 1].map((idx) => {
          const r = layout.rects[idx];
          return (
            <React.Fragment key={`deco-${idx}`}>
              <View
                style={[styles.imgBorder, {
                  left: r.x, top: r.y - HEADER_H,
                  width: r.w, height: r.h,
                  borderColor: idx === 0 ? theme.shadow : theme.dark,
                }]}
                pointerEvents="none"
              />
              <View style={[styles.imgLabel, { left: r.x + 4, top: r.y - HEADER_H + 4 }]} pointerEvents="none">
                <Text style={styles.imgLabelTxt}>{idx + 1}</Text>
              </View>
            </React.Fragment>
          );
        })}

        {handles.map((h, i) => (
          <View
            key={`h-${i}`}
            style={[
              styles.handleBar,
              h.horiz ? styles.handleH : styles.handleV,
              {
                left: h.x - (h.horiz ? HANDLE_LEN / 2 : HANDLE_THICK / 2),
                top: h.y - HEADER_H - (h.horiz ? HANDLE_THICK / 2 : HANDLE_LEN / 2),
              },
              h.type === 'overlap' && styles.handleOverlap,
            ]}
            pointerEvents="none"
          />
        ))}
      </View>

      <Win95InsetPanel style={styles.controlPanel}>
        <View style={styles.controlRow}>
          <Win95Button small onPress={toggleDirection} disabled={busy}>
            {isVert ? '↕ Vertical' : '↔ Horizontal'}
          </Win95Button>
          <Win95Button small onPress={swapOrder} disabled={busy}>⇅ Swap</Win95Button>
          <Win95Button small onPress={toggleTopLayer} disabled={busy}>
            ☰ Top: {params.topLayerIndex + 1}
          </Win95Button>
        </View>
        <View style={styles.controlRow}>
          <Text style={styles.overlapLabel}>Overlap: {params.overlap}px</Text>
          <Win95Button small onPress={() => adjustOverlap(-50)} disabled={busy}>−50</Win95Button>
          <Win95Button small onPress={() => adjustOverlap(-10)} disabled={busy}>−10</Win95Button>
          <Win95Button small onPress={() => adjustOverlap(10)} disabled={busy}>+10</Win95Button>
          <Win95Button small onPress={() => adjustOverlap(50)} disabled={busy}>+50</Win95Button>
        </View>
      </Win95InsetPanel>

      <View style={styles.actionRow}>
        <Win95Button onPress={onCancel} disabled={busy}>Cancel</Win95Button>
        <View style={{ flex: 1 }} />
        <Win95Button onPress={confirmCompose} disabled={busy} primary>Stitch & Insert</Win95Button>
      </View>

      {busy && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={theme.text} />
          <Text style={styles.busyTxt}>Compositing…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function computeHandles(layout: Layout, isVert: boolean) {
  const r0 = layout.rects[0];
  const r1 = layout.rects[1];
  const juncY = isVert ? (r0.y + r0.h + r1.y) / 2 : (r0.y + r0.h / 2);
  const juncX = isVert ? (r0.x + r0.w / 2) : (r0.x + r0.w + r1.x) / 2;
  if (isVert) {
    return [
      { x: r0.x + r0.w / 2, y: r0.y,         horiz: true, type: 'outerAxis' as const },
      { x: r1.x + r1.w / 2, y: r1.y + r1.h,  horiz: true, type: 'outerAxis' as const },
      { x: juncX, y: juncY,                  horiz: true, type: 'overlap' as const },
      { x: layout.originX,                  y: juncY, horiz: false, type: 'perpShared' as const },
      { x: layout.originX + layout.dispW,   y: juncY, horiz: false, type: 'perpShared' as const },
    ];
  }
  return [
    { x: r0.x,             y: r0.y + r0.h / 2, horiz: false, type: 'outerAxis' as const },
    { x: r1.x + r1.w,      y: r1.y + r1.h / 2, horiz: false, type: 'outerAxis' as const },
    { x: juncX, y: juncY,                       horiz: false, type: 'overlap' as const },
    { x: juncX, y: layout.originY,             horiz: true, type: 'perpShared' as const },
    { x: juncX, y: layout.originY + layout.dispH, horiz: true, type: 'perpShared' as const },
  ];
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { fontFamily: 'VT323', fontSize: 18, color: theme.text },
  preview: { position: 'relative', backgroundColor: theme.bg },
  compositeBorder: { position: 'absolute', borderWidth: 1, borderColor: theme.shadow },
  imgBorder: { position: 'absolute', borderWidth: 1, borderStyle: 'dashed' },
  imgLabel: { position: 'absolute', backgroundColor: theme.titleBg, paddingHorizontal: 6, paddingVertical: 2 },
  imgLabelTxt: { color: theme.titleFg, fontSize: 13, fontFamily: 'VT323' },
  overlapZone: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)', borderStyle: 'dotted',
  },
  handleBar: { position: 'absolute', backgroundColor: theme.text, borderRadius: 3 },
  handleH: { width: HANDLE_LEN, height: HANDLE_THICK },
  handleV: { width: HANDLE_THICK, height: HANDLE_LEN },
  handleOverlap: { backgroundColor: theme.shadow },
  controlPanel: { padding: 6, gap: 6 },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  overlapLabel: { fontFamily: 'VT323', fontSize: 15, color: theme.text, minWidth: 110 },
  actionRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    alignItems: 'center', backgroundColor: theme.bg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(192,192,192,0.7)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  busyTxt: { fontFamily: 'VT323', fontSize: 16, color: theme.text },
});
