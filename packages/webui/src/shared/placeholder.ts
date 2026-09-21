// Shared type surface between the WebUI server and client.
//
// This small shared module keeps the server/client build entries independent.
// The runtime-facing protocol projection lives in the server port instead of
// re-exporting `@mavis/protocol/local`, which would pull the process-local
// contract into the browser bundle.

export type WebuiFoundationVersion = "0.1.0";

export const WEBUI_FOUNDATION_VERSION: WebuiFoundationVersion = "0.1.0";

export function describeWebuiFoundation(): string {
  return `webui-foundation ${WEBUI_FOUNDATION_VERSION}`;
}
