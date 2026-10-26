import { katex as katexPlugin } from "@mdit/plugin-katex";
// Side-effect import: registers the mhchem macros on KaTeX.
import "@mdit/plugin-katex/mhchem";
import katex from "katex";
import type { MarkdownIt } from "markdown-it";

export const MATH_BLOCK_KIND = "math" as const;
export const MATH_INLINE_TOKEN = "math_inline";

/** One KaTeX configuration for the parser plugin and for direct rendering. */
export const KATEX_OPTIONS = { output: "htmlAndMathml", throwOnError: false } as const;

export const renderMath = (tex: string, display: boolean): string =>
  katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display });

/** Install the math syntax on the one parser; the plugin owns both tokens. */
export const mathPlugin = (markdownIt: MarkdownIt): void => {
  markdownIt.use(katexPlugin, KATEX_OPTIONS);
};
