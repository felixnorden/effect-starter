/**
 * The page-title precedence: an explicitly configured template wins with the
 * basename in its `${name}` slot, else a front-matter title, else the template
 * (the default `「${name}」`).
 */
export const previewTitle = (input: {
  readonly template: string;
  readonly explicit: boolean;
  readonly name: string;
  readonly frontMatterTitle: string | null;
}): string => {
  if (!input.explicit && input.frontMatterTitle !== null) return input.frontMatterTitle;
  return input.template.replaceAll("${name}", input.name);
};
