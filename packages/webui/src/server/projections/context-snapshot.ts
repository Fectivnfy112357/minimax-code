export interface WebuiContextSnapshotResponse {
  readonly status: "loading" | "empty" | "stale" | "live";
  readonly compaction?: {
    readonly state: "never" | "running" | "completed" | "failed";
    readonly lastAt?: number;
  };
  readonly usage?: Record<string, unknown>;
  readonly window?: number;
  readonly usedTokens?: number;
  readonly compactionThresholdTokens?: number;
}

export function projectContextSnapshot(input: {
  readonly messages: readonly { readonly kind?: string; readonly timestamp?: number; readonly rawJson?: string }[];
  readonly active: boolean;
}): WebuiContextSnapshotResponse {
  let compaction: WebuiContextSnapshotResponse["compaction"];
  let usage: Record<string, unknown> | undefined;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (!message) continue;
    if (!compaction) compaction = projectCompactionMessage(message);
    if (!usage && message.rawJson) usage = readUsage(message.rawJson);
    if (compaction && usage) break;
  }
  if (!usage) return { status: input.active ? "loading" : "empty", ...(compaction ? { compaction } : {}) };
  const window = numberValue(usage.contextWindowTokens);
  const usedTokens = numberValue(usage.usedTokens);
  return {
    status: input.active ? "stale" : "live",
    usage,
    ...(window === undefined ? {} : { window }),
    ...(usedTokens === undefined ? {} : { usedTokens }),
    compaction: compaction ?? { state: "never" },
  };
}

function projectCompactionMessage(message: { readonly kind?: string; readonly timestamp?: number }) {
  const states = { compaction_start: "running", compaction: "completed", compaction_failed: "failed" } as const;
  const state = message.kind ? states[message.kind as keyof typeof states] : undefined;
  return state ? { state, ...(message.timestamp === undefined ? {} : { lastAt: message.timestamp }) } : undefined;
}

function readUsage(rawJson: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(rawJson);
    if (!isRecord(value)) return undefined;
    return isRecord(value.contextUsage) ? value.contextUsage : isRecord(value.context_usage) ? value.context_usage : undefined;
  } catch {
    return undefined;
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

