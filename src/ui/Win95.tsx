import React, { ReactNode, useState } from 'react';
import {
  GestureResponderEvent,
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { insetEdges, outsetEdges, PIXEL_FONT, theme } from './theme';

// ---- Frames ----

export function Win95Frame({ children, style, ...rest }: ViewProps): React.JSX.Element {
  return (
    <View style={[styles.frameOuter, style]} {...rest}>
      <View style={styles.frameInner}>{children}</View>
    </View>
  );
}

export function Win95InsetPanel({ children, style, ...rest }: ViewProps): React.JSX.Element {
  return (
    <View style={[styles.inset, style]} {...rest}>
      {children}
    </View>
  );
}

// ---- Button ----

export function Win95Button(props: PressableProps & {
  children?: ReactNode;
  active?: boolean;
  primary?: boolean;
  small?: boolean;
}): React.JSX.Element {
  const { children, active, primary, small, style, ...rest } = props;
  const [pressed, setPressed] = useState(false);
  const looksDown = pressed || active;

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => { setPressed(true); rest.onPressIn?.(e); }}
      onPressOut={(e) => { setPressed(false); rest.onPressOut?.(e); }}
      style={({ pressed: p }) => [
        styles.btnOuter,
        looksDown || p ? insetEdges() : outsetEdges(),
        small ? styles.btnSmall : null,
        typeof style === 'function' ? (style as any)({ pressed: p }) : style,
      ]}
    >
      <View style={[
        styles.btnInner,
        small ? styles.btnInnerSmall : null,
        primary ? styles.btnPrimary : null,
      ]}>
        {typeof children === 'string' ? (
          <Text style={[styles.btnText, primary && styles.btnTextPrimary]}>{children}</Text>
        ) : children}
      </View>
    </Pressable>
  );
}

// ---- Title bar (Win95 window header with X close button) ----

export function TitleBar({
  title,
  onClose,
}: {
  title: string;
  onClose?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.titleBar}>
      <Text style={styles.titleText} numberOfLines={1}>{title}</Text>
      {onClose ? (
        <Pressable onPress={onClose} style={styles.titleCloseOuter}>
          <View style={[styles.titleCloseInner, outsetEdges()]}>
            <Text style={styles.titleCloseX}>x</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Menu bar ("File", "Edit"…) with simple drop-down ----

export type MenuItem = {
  label: string;
  onPress?: () => void;
  separator?: boolean;
  disabled?: boolean;
};

export type MenuSpec = { label: string; items: MenuItem[] };

export function MenuBar({ menus }: { menus: MenuSpec[] }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <View style={styles.menuBarWrap}>
      <View style={styles.menuBar}>
        {menus.map((m) => (
          <Pressable
            key={m.label}
            onPress={() => setOpen((o) => (o === m.label ? null : m.label))}
            style={[styles.menuLabel, open === m.label && styles.menuLabelOpen]}
          >
            <Text style={[styles.menuLabelText, open === m.label && styles.menuLabelTextOpen]}>
              {m.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {open ? (
        <Win95Frame style={styles.menuDropdown}>
          {(menus.find((m) => m.label === open)?.items ?? []).map((it, i) =>
            it.separator ? (
              <View key={i} style={styles.menuSeparator} />
            ) : (
              <Pressable
                key={i}
                disabled={it.disabled}
                onPress={() => {
                  setOpen(null);
                  it.onPress?.();
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed,
                ]}
              >
                <Text style={[styles.menuItemText, it.disabled && styles.menuItemDisabled]}>
                  {it.label}
                </Text>
              </Pressable>
            ),
          )}
        </Win95Frame>
      ) : null}
    </View>
  );
}

// ---- Status bar (bottom strip used like a Win95 app status line) ----

export function StatusBar({ children }: { children: ReactNode }): React.JSX.Element {
  return <View style={styles.statusBar}>{typeof children === 'string'
    ? <Text style={styles.statusText}>{children}</Text>
    : children}</View>;
}

export function Field({ children, style }: { children: ReactNode; style?: ViewStyle }): React.JSX.Element {
  return <View style={[styles.inset, styles.field, style]}>{children}</View>;
}

export function PixelText({ children, style, ...rest }: TextProps): React.JSX.Element {
  return <Text {...rest} style={[styles.pixel, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  frameOuter: {
    backgroundColor: theme.bg,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.highlight, borderLeftColor: theme.highlight,
    borderRightColor: theme.dark, borderBottomColor: theme.dark,
  },
  frameInner: {
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.bg, borderLeftColor: theme.bg,
    borderRightColor: theme.shadow, borderBottomColor: theme.shadow,
  },
  inset: {
    backgroundColor: theme.inset,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: theme.shadow, borderLeftColor: theme.shadow,
    borderRightColor: theme.highlight, borderBottomColor: theme.highlight,
  },
  field: { paddingHorizontal: 8, paddingVertical: 6 },
  btnOuter: {
    backgroundColor: theme.bg,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 4 },
  btnInner: { alignItems: 'center', justifyContent: 'center' },
  btnInnerSmall: {},
  btnPrimary: {},
  btnText: {
    fontFamily: PIXEL_FONT,
    fontSize: 18,
    color: theme.text,
    includeFontPadding: false as any,
  },
  btnTextPrimary: { fontWeight: '700' as const },
  titleBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.titleBg,
    paddingHorizontal: 4, paddingVertical: 2,
  },
  titleText: {
    flex: 1, color: theme.titleFg,
    fontFamily: PIXEL_FONT, fontSize: 18, fontWeight: '700',
    paddingHorizontal: 4,
  },
  titleCloseOuter: { padding: 2 },
  titleCloseInner: {
    width: 20, height: 18,
    backgroundColor: theme.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  titleCloseX: { fontFamily: PIXEL_FONT, fontSize: 16, color: theme.text, lineHeight: 16 },
  menuBarWrap: { position: 'relative', zIndex: 10 },
  menuBar: {
    flexDirection: 'row',
    backgroundColor: theme.bg,
    paddingHorizontal: 2, paddingVertical: 2,
    borderBottomWidth: 1, borderBottomColor: theme.shadow,
  },
  menuLabel: { paddingHorizontal: 8, paddingVertical: 4 },
  menuLabelOpen: { backgroundColor: theme.selBg },
  menuLabelText: { fontFamily: PIXEL_FONT, fontSize: 16, color: theme.text },
  menuLabelTextOpen: { color: theme.selFg },
  menuDropdown: {
    position: 'absolute',
    top: 28, left: 4,
    minWidth: 200,
    paddingVertical: 2,
    zIndex: 20,
    elevation: 20,
  },
  menuItem: { paddingHorizontal: 16, paddingVertical: 4 },
  menuItemPressed: { backgroundColor: theme.selBg },
  menuItemText: { fontFamily: PIXEL_FONT, fontSize: 16, color: theme.text },
  menuItemDisabled: { color: theme.shadow },
  menuSeparator: {
    height: 2, marginVertical: 3, marginHorizontal: 4,
    borderTopWidth: 1, borderTopColor: theme.shadow,
    borderBottomWidth: 1, borderBottomColor: theme.highlight,
  },
  statusBar: {
    flexDirection: 'row',
    backgroundColor: theme.bg,
    paddingHorizontal: 4, paddingVertical: 4,
    borderTopWidth: 1, borderTopColor: theme.shadow,
  },
  statusText: { fontFamily: PIXEL_FONT, fontSize: 14, color: theme.text },
  pixel: { fontFamily: PIXEL_FONT, fontSize: 16, color: theme.text },
});
