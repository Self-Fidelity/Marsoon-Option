import { parseCandleStreamMessage, type CandleStreamBatch } from "../board/candle-stream";

export interface CandleStreamHandlers {
  onBatch: (batch: CandleStreamBatch) => void;
  onOpen: (reconnected: boolean) => void;
}

interface CandleStreamConnection {
  symbol: string;
  subscribers: Set<CandleStreamHandlers>;
  socket: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  openedOnce: boolean;
  disposed: boolean;
}

const connections = new Map<string, CandleStreamConnection>();

function scheduleReconnect(connection: CandleStreamConnection) {
  if (connection.disposed || connection.reconnectTimer) return;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(connection.attempts++, 5));
  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = null;
    void connect(connection);
  }, delay);
}

async function connect(connection: CandleStreamConnection) {
  try {
    const session = await fetch("/api/auth/session", { cache: "no-store", credentials: "include" });
    if (!session.ok || connection.disposed) { scheduleReconnect(connection); return; }
    const ticket = await fetch("/api/auth/candles-ws", { cache: "no-store", credentials: "include" });
    if (!ticket.ok || connection.disposed) { scheduleReconnect(connection); return; }
    const body = await ticket.json() as { url?: unknown };
    if (typeof body.url !== "string" || connection.disposed) { scheduleReconnect(connection); return; }

    const socket = new WebSocket(body.url);
    connection.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      connection.attempts = 0;
      socket.send(JSON.stringify({ method: "subscribe", data: { stream: 4, pair: { exchange: "DATABENTO", symbol: connection.symbol }, timeframe: 60 } }));
      for (const handlers of connection.subscribers) handlers.onOpen(connection.openedOnce);
      connection.openedOnce = true;
    };
    socket.onmessage = async (event) => {
      if (connection.disposed) return;
      let text: string;
      if (typeof event.data === "string") text = event.data;
      else if (event.data instanceof ArrayBuffer) text = new TextDecoder().decode(event.data);
      else if (event.data instanceof Blob) text = await event.data.text();
      else return;
      const batch = parseCandleStreamMessage(text);
      if (!batch || batch.symbol !== connection.symbol) return;
      for (const handlers of connection.subscribers) handlers.onBatch(batch);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => scheduleReconnect(connection);
  } catch {
    scheduleReconnect(connection);
  }
}

/** Shared per-symbol candles websocket: one connection no matter how many board windows subscribe. */
export function acquireCandleStream(symbol: string, handlers: CandleStreamHandlers): () => void {
  let connection = connections.get(symbol);
  if (!connection) {
    connection = {
      symbol,
      subscribers: new Set(),
      socket: null,
      reconnectTimer: null,
      attempts: 0,
      openedOnce: false,
      disposed: false,
    };
    connections.set(symbol, connection);
    void connect(connection);
  }
  connection.subscribers.add(handlers);
  return () => {
    connection.subscribers.delete(handlers);
    if (connection.subscribers.size) return;
    connection.disposed = true;
    connections.delete(symbol);
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    const socket = connection.socket;
    connection.socket = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ method: "unsubscribe", data: { stream: 4, pair: { exchange: "DATABENTO", symbol }, timeframe: 60 } }));
    }
    socket?.close();
  };
}
