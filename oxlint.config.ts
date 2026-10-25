import { recommended as effectRecommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

// One config for the whole monorepo. The root `lint` and `fmt` scripts run from
// this directory, so patterns are relative to the repo root.
export default defineConfig({
  // Effect's type-aware rules. `oxlint-tsgolint` supplies the type checker, and
  // `bun run patch:tsgo` puts the same diagnostics in `tsc`. The spread brings in
  // `options.typeAware: true`, which is what makes these rules run at all.
  ...effectRecommended,
  plugins: ["effecttsgo", "typescript", "unicorn", "oxc", "import", "node", "promise"],
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  rules: {
    ...effectRecommended.rules,
  },
});
