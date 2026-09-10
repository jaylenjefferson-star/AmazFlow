// The AmazFlow design system, promoted out of the staff console (task 9.1).
//
// These primitives were written for `/app` and are the reason that surface is coherent: page
// headers, cards, tables, buttons, form fields, badges, status indicators, modals, drawers, toasts,
// skeletons, empty states and error states, each with one implementation and one set of states.
// The customer console had none of them -- it hand-rolled its own markup per screen, which is why
// the two surfaces do not look like the same product and why a loading state exists on one and not
// the other.
//
// Promoting rather than reimplementing is deliberate: these components already carry the
// three-state discipline (skeleton / honest empty / error with a reason) that Phase 13's honesty
// work depends on, and rewriting them for the customer app would have produced a second set of
// states to keep in agreement.
//
// Styling stays in `ops.css`, which each surface imports. That is a real coupling and it is named
// here rather than hidden: the components render `ops-` prefixed class names, so a surface that
// does not ship the stylesheet gets unstyled markup rather than a broken build.

export * from "./primitives";
export * from "./icons";
