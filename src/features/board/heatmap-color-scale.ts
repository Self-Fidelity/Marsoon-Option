export type RGB = readonly [number, number, number];

export const HEATMAP_PALETTE_SIZE = 256;

function parseHex(color: string): RGB {
  const value = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ];
  }
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return [
      Number.parseInt(value[1]! + value[1]!, 16),
      Number.parseInt(value[2]! + value[2]!, 16),
      Number.parseInt(value[3]! + value[3]!, 16),
    ];
  }
  return [0, 0, 0];
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount),
  ];
}

function rgb(color: RGB) {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

/** Build an opaque 256-color lookup table from multiple sRGB-interpolated nodes. */
export function buildOpaquePalette(background: string, base: string, hot: string): string[] {
  const bg = parseHex(background);
  const normal = parseHex(base);
  const nodes: Array<{ at: number; color: RGB }> = [
    { at: 0, color: bg },
    { at: .28, color: mix(bg, normal, .35) },
    { at: .68, color: normal },
    { at: 1, color: parseHex(hot) },
  ];
  return Array.from({ length: HEATMAP_PALETTE_SIZE }, (_, index) => {
    const position = index / (HEATMAP_PALETTE_SIZE - 1);
    const upperIndex = Math.min(nodes.length - 1, Math.max(1, nodes.findIndex((node) => position <= node.at)));
    const lower = nodes[upperIndex - 1]!;
    const upper = nodes[upperIndex]!;
    const amount = (position - lower.at) / Math.max(1e-9, upper.at - lower.at);
    return rgb(mix(lower.color, upper.color, amount));
  });
}

/** Linear normalization; values at or above the cap share the hottest color. */
export function heatmapPaletteIndex(value: number, maximum: number) {
  const intensity = Math.min(1, Math.abs(value) / Math.max(maximum, 1e-9));
  return Math.round(intensity * (HEATMAP_PALETTE_SIZE - 1));
}
