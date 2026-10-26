import { defineConfig } from "oxfmt";

// One config for the whole monorepo. The root scripts run `oxfmt` from this
// directory. Unset options keep the defaults: 2-space indent, double quotes,
// 80-column print width.
export default defineConfig({
  // Committed generator output and pinned snapshot HTML are not hand-formatted.
  ignorePatterns: ["fixtures/generated/**", "**/__snapshots__/*.html"],
});
