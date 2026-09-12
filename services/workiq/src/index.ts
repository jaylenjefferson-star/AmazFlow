// WorkIQ is a separate AmazFlow product surface and service, kept behind its own data and schema
// boundary from the execution control plane. See docs/WORKIQ_COMPLIANCE.md for the privacy
// posture this package enforces (metadata-only telemetry, human-confirmed opportunities, and a
// narrow handoff contract into AmazFlow).

export * from "./departments.js";
export * from "./relationships.js";
export * from "./sessions.js";
export * from "./classifications.js";
export * from "./disputes.js";
export * from "./opportunities.js";
export * from "./handoff.js";
export * from "./tenant.js";
export * from "./principal-bridge.js";
