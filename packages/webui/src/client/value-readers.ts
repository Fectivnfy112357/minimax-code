// Pure value readers used by the projection layer.
//
// These helpers do the dull work of pulling a typed value out of an
// `unknown`: the wire frames, the persisted JSON, and the message bodies all
// hand the client heterogeneous shapes, and centralising the trim/number/
// boolean coercion keeps the projection files focused on shape instead of
// type narrowing. They are deliberately side-effect free so they can live in
// the same dependency layer as `contracts.ts` (no React, no I/O).

export function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Read a string from any of the named keys on a record, in order, accepting
 * either camelCase or snake_case spellings the wire layer carries. Returns the
 * first non-empty trimmed string, or undefined when none qualifies.
 */
export function readStringAliases(
  value: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

/**
 * Read a number from any of the named keys on a record, in order. Returns the
 * first finite number, or undefined when none qualifies. The wire layer hands
 * the client both camelCase and snake_case keys for the same value.
 */
export function readNumberAliases(
  value: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate))
      return candidate;
  }
  return undefined;
}

/**
 * Project an unknown error into a human-readable string for the user-facing
 * `refusal` field or for the `interactionError` banner. The original code
 * repeated `error instanceof Error ? error.message : String(error)` in 41
 * places; this is the single convergence point so messages stay consistent
 * and unknown errors still produce something readable.
 */
export function formatWebuiError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}