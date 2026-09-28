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
 * Project an unknown error into a human-readable string for the user-facing
 * `refusal` field or for the `interactionError` banner. The original code
 * repeated `error instanceof Error ? error.message : String(error)` in 41
 * places; this is the single convergence point so messages stay consistent
 * and unknown errors still produce something readable.
 */
export function formatWebuiError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}