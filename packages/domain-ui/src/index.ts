// The shared domain layer: one vocabulary, one run narrative, one route table shape, one data
// provider.
//
// Task 9.2's requirement is a counting one -- exactly one enumeration-to-label mapping and exactly
// one run-narrative model in the repository. Before this package there were two: `ops/terms.ts` for
// the staff console and `console/copy.ts` for the customer one, with separately maintained status
// and provider maps that had already diverged on which statuses exist. Two mappings mean two
// answers to "what does WAITING_AGENT mean", and the one a customer sees is the one that becomes
// true for them.
//
// So `terms.ts` and `run-model.ts` moved here verbatim, and every surface reads them.

export * from "./terms";
export * from "./run-model";
export * from "./route-table";
export * from "./resource-provider";
