"use client";

// Moved to `@amazflow/ui` in task 9.1. This re-export keeps every `/app` view and the customer
// console importing `./primitives` unchanged, which is what lets the design system be shared without
// a mechanical rewrite of twenty-odd call sites in the same commit that moves the files.
//
// Task 28.4 retires this shim along with the rest of the `/app` surface.
export * from "@amazflow/ui";
