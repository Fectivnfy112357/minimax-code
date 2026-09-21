// Server entry for the WebUI package. Ticket 03 ships the real service
// seam: a process that owns a runtime host, binds loopback, refuses
// foreign Host / Origin headers and missing per-start credentials, answers
// the version query, and shuts down in the order the assembly checklist
// step 13 requires. Source ends at `WEBUI_FOUNDATION_VERSION` so the
// standalone CLI build never bundles the server module (it is its own
// entry in `scripts/build-webui.mjs`).

import {
  WEBUI_FOUNDATION_VERSION,
  type WebuiFoundationVersion,
} from "../shared/placeholder.js";

export const WEBUI_SERVER_VERSION: WebuiFoundationVersion = WEBUI_FOUNDATION_VERSION;

export interface WebuiServerFoundation {
  readonly version: WebuiFoundationVersion;
}

export function createWebuiServerFoundation(): WebuiServerFoundation {
  return { version: WEBUI_SERVER_VERSION };
}

export {
  WebuiService,
  WEBUI_MAX_MESSAGE_BYTES,
  type WebuiServiceInfo,
  type WebuiServiceOptions,
} from "./service.js";
export {
  createOperationRegistry,
  type WebuiOperation,
  type WebuiOperationHandler,
  type WebuiOperationRegistryEntry,
  type WebuiOperationResult,
} from "./operations.js";
export {
  createWebuiCredential,
  credentialMatches,
  type WebuiCredential,
} from "./credentials.js";
export {
  WEBUI_PROTOCOL_VERSION,
  WebuiErrorCode,
  isWebuiFrame,
  type WebuiRequestFrame,
  type WebuiResponseFrame,
  type WebuiErrorFrame,
  type WebuiServerFrame,
  type WebuiClientFrame,
  type WebuiFrame,
  type WebuiEnvelopeKind,
  type WebuiErrorCodeValue,
} from "./envelope.js";
export type { WebuiHarnessPort, WebuiVersionInfo } from "./port.js";
export {
  createHarnessPortFromHost,
  type WebuiRuntimeHostHandle,
} from "./host.js";