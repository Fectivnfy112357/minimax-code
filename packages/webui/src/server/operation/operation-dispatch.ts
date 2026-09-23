import type { WebSocket } from "ws";
import {
  isWebuiFrame,
  WebuiErrorCode,
  WEBUI_PROTOCOL_VERSION,
  type WebuiErrorFrame,
  type WebuiEventFrame,
  type WebuiResponseFrame,
} from "../envelope.js";
import type { WebuiOperationRegistryEntry } from "./operations.js";

export async function dispatchWebuiFrame(
  ws: WebSocket,
  parsed: unknown,
  operations: ReadonlyMap<string, WebuiOperationRegistryEntry>,
  accepting: boolean,
  getSignal: () => AbortSignal | undefined,
): Promise<void> {
    if (!isWebuiFrame(parsed)) {
      sendFrame(
        ws,
        errorFrame(
          "anonymous",
          WebuiErrorCode.protocolMismatch,
          "frame does not match the WebUI envelope",
        ),
      );
      return;
    }
    if (parsed.kind !== "request") {
      sendFrame(
        ws,
        errorFrame(
          parsed.requestId,
          WebuiErrorCode.invalidEnvelope,
          "servers do not accept client non-request frames",
        ),
      );
      return;
    }
    if (!accepting) {
      sendFrame(
        ws,
        errorFrame(
          parsed.requestId,
          WebuiErrorCode.shuttingDown,
          "service is shutting down",
        ),
      );
      return;
    }
    const entry = operations.get(parsed.operation);
    if (!entry) {
      sendFrame(
        ws,
        errorFrame(
          parsed.requestId,
          WebuiErrorCode.unknownOperation,
          `unknown operation: ${parsed.operation}`,
        ),
      );
      return;
    }
    const validated = entry.operation.validate(parsed.body);
    if (!validated.ok) {
      sendFrame(
        ws,
        errorFrame(parsed.requestId, validated.code, validated.message),
      );
      return;
    }
    try {
      const result = await entry.handle(
        {
          requestId: parsed.requestId,
          signal: getSignal(),
        },
        validated.body,
      );
      if ("stream" in result) {
        if (!result.stream.ok) {
          sendFrame(
            ws,
            errorFrame(
              parsed.requestId,
              result.stream.body.key ?? WebuiErrorCode.harnessError,
              result.stream.body.message,
            ),
          );
          return;
        }
        const iterator = toAsyncIterator(
          result.stream.source as AsyncIterable<unknown> | Iterable<unknown>,
        );
        const signal = getSignal();
        const close = () => void iterator.return?.();
        signal?.addEventListener("abort", close, { once: true });
        try {
          while (!signal?.aborted) {
            const next = await iterator.next();
            if (next.done || signal?.aborted) break;
            sendFrame(ws, eventFrame(parsed.requestId, next.value));
          }
        } finally {
          signal?.removeEventListener("abort", close);
          await iterator.return?.();
        }
        return;
      }
      sendFrame(ws, responseFrame(parsed.requestId, result.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode =
        error && typeof error === "object" &&
        typeof (error as { readonly code?: unknown }).code === "string" &&
        Object.values(WebuiErrorCode).includes(
          (error as { readonly code: string }).code as (typeof WebuiErrorCode)[keyof typeof WebuiErrorCode],
        )
          ? ((error as { readonly code: string }).code as (typeof WebuiErrorCode)[keyof typeof WebuiErrorCode])
          : WebuiErrorCode.harnessError;
      sendFrame(
        ws,
        errorFrame(parsed.requestId, errorCode, message),
      );
    }
}

function toAsyncIterator<T>(
  source: AsyncIterable<T> | Iterable<T>,
): AsyncIterator<T> {
  if (Symbol.asyncIterator in source) return source[Symbol.asyncIterator]();
  const iterator = source[Symbol.iterator]();
  return {
    next: () => Promise.resolve(iterator.next()),
    return: (value?: unknown) =>
      Promise.resolve(iterator.return?.(value) ?? { done: true, value }),
  };
}

export function sendFrame(
  ws: WebSocket,
  frame: WebuiResponseFrame | WebuiErrorFrame | WebuiEventFrame,
) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(frame));
}

function eventFrame(requestId: string, body: unknown): WebuiEventFrame {
  return {
    protocolVersion: WEBUI_PROTOCOL_VERSION,
    kind: "event",
    requestId,
    body,
  };
}

function responseFrame(requestId: string, body: unknown): WebuiResponseFrame {
  return {
    protocolVersion: WEBUI_PROTOCOL_VERSION,
    kind: "response",
    requestId,
    body,
  };
}

export function errorFrame(
  requestId: string,
  code: string,
  message: string,
): WebuiErrorFrame {
  return {
    protocolVersion: WEBUI_PROTOCOL_VERSION,
    kind: "error",
    requestId,
    code,
    message,
  };
}
