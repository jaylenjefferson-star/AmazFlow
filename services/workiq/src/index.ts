// WorkIQ is a separate AmazFlow product surface and service, kept behind its own data and schema
// boundary from the execution control plane. See docs/WORKIQ_COMPLIANCE.md for the privacy
// posture this package enforces (metadata-only telemetry, human-confirmed opportunities, and a
// narrow handoff contract into AmazFlow).

export * from "./departments";
export * from "./relationships";
export * from "./sessions";
export * from "./classifications";
export * from "./disputes";
export * from "./opportunities";
export * from "./handoff";
export * from "./tenant";
export * from "./principal-bridge";
