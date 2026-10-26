declare module "markdown-it-deflist" {
  import type MarkdownIt from "markdown-it";

  const deflist: (markdownIt: MarkdownIt) => void;

  export default deflist;
}
