// Harness seam for the WebUI service.
//
// The service uses this port to reach the harness layer; the real
// implementation is wired to the in-process runtime host (ADR 0001) and its
// `CliService` facade. Tests substitute a scripted stand-in so the access
// control, transport, envelope and shutdown story can be exercised without
// owning a real database (ADR 0006).
//
// The ticket only needs `version()`: assembly steps 5 (tool capabilities)
// and 10 (send/stream) belong to later tickets, so the surface stays
// minimal and never pretends to be the full application facade.

export interface WebuiVersionInfo {
  readonly version: string;
  readonly protocolVersion: number;
}

export interface WebuiHarnessPort {
  version(): WebuiVersionInfo;
  /**
   * Release anything the port owns. The service calls this after closing
   * every transport-side resource so the harness can tear itself down in
   * the order step 13 of the assembly checklist requires.
   */
  close(): Promise<void>;
}