import { BOARD_PANELS } from "./panel-registry";
import type { BoardDockPayload } from "./board-dock-layout";

/**
 * 看板级第三十三轮：布局分享链接编解码。
 * JSON → CompressionStream("deflate")（浏览器原生，无依赖）→ base64url，前缀 "v1."；
 * CompressionStream 不可用时回退未压缩 base64url，前缀 "v0."。
 * atob/btoa 只认 Latin-1，Unicode 须先 TextEncoder/TextDecoder 转字节。
 */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeBoardShare(payload: BoardDockPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream !== "undefined") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      return `v1.${bytesToBase64Url(compressed)}`;
    } catch {
      // 压缩失败回退未压缩
    }
  }
  return `v0.${bytesToBase64Url(bytes)}`;
}

/** 校验口径与 applyPayload 一致：version/layout 存在 + panels 的 panelKey 全部在注册表内 */
function isValidPayload(value: unknown): value is BoardDockPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<BoardDockPayload>;
  if (typeof payload.version !== "number" || !payload.layout) return false;
  const panels = (payload.layout as { panels?: Record<string, { params?: { panelKey?: string } }> })
    .panels;
  if (panels && typeof panels === "object") {
    for (const panel of Object.values(panels)) {
      const panelKey = panel?.params?.panelKey;
      if (panelKey && !BOARD_PANELS.some((def) => def.key === panelKey)) return false;
    }
  }
  return true;
}

export async function decodeBoardShare(text: string): Promise<BoardDockPayload | null> {
  try {
    const dot = text.indexOf(".");
    if (dot < 0) return null;
    const tag = text.slice(0, dot);
    const body = text.slice(dot + 1);
    let json: string;
    if (tag === "v1") {
      if (typeof DecompressionStream === "undefined") return null;
      const stream = new Blob([new Uint8Array(base64UrlToBytes(body))])
        .stream()
        .pipeThrough(new DecompressionStream("deflate"));
      json = await new Response(stream).text();
    } else if (tag === "v0") {
      json = new TextDecoder().decode(base64UrlToBytes(body));
    } else {
      return null;
    }
    const parsed: unknown = JSON.parse(json);
    return isValidPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
