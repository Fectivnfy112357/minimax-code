// Shared type surface between the WebUI server and client.
//
// Ticket 01 ships no behaviour, only a typed module both sides can reach.
// The actual protocol shapes live in `@mavis/protocol/local`; re-exporting
// them here would pull client code into the server bundle, so this module
// starts empty and grows with the wire envelope in later tickets.

export type WebuiFoundationVersion = "0.1.0";

export const WEBUI_FOUNDATION_VERSION: WebuiFoundationVersion = "0.1.0";

export function describeWebuiFoundation(): string {
  return `webui-foundation ${WEBUI_FOUNDATION_VERSION}`;
}
