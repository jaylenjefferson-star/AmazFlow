// Test-only preamble for the task 9.13 rendering tests.
//
// Next compiles this surface with `jsx: "preserve"` and applies its own transform, and it rewrites that
// setting back if you change it. The rendering tests run under tsx with no bundler in front of them, so
// the JSX they and the shared UI package contain is compiled with the CLASSIC transform — which emits
// `React.createElement` and expects `React` to be in scope.
//
// Putting React on the global satisfies that without touching a single source file. It has to happen
// before any component module is evaluated, which is why this is imported FIRST in each test file:
// ES module dependencies are evaluated in source order, so a later import cannot fix an earlier one.
import * as React from "react";

(globalThis as unknown as Record<string, unknown>).React = React;
