import test from "node:test";
import assert from "node:assert/strict";
import { patternClassificationSchema } from "./classifications.js";

const now = new Date().toISOString();

test("an observed classification may have zero samples so far", () => {
  const value = patternClassificationSchema.parse({
    id: "cls-1", tenantId: "tenant-a", patternKey: "weekly-report", description: "Weekly report pattern",
    sampleSize: 0, confidenceScore: 0.2, status: "observed", createdAt: now, updatedAt: now
  });
  assert.equal(value.status, "observed");
});

test("a confirmed classification must be backed by at least one sample", () => {
  assert.throws(() =>
    patternClassificationSchema.parse({
      id: "cls-1", tenantId: "tenant-a", patternKey: "weekly-report", description: "Weekly report pattern",
      sampleSize: 0, confidenceScore: 0.9, status: "confirmed", createdAt: now, updatedAt: now
    })
  );
});

test("confidence score is bounded between 0 and 1", () => {
  assert.throws(() =>
    patternClassificationSchema.parse({
      id: "cls-1", tenantId: "tenant-a", patternKey: "weekly-report", description: "Weekly report pattern",
      sampleSize: 5, confidenceScore: 1.5, status: "observed", createdAt: now, updatedAt: now
    })
  );
});
