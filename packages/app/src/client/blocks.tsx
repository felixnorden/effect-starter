import type { BlockId, WireBlock } from "@mdv/core/protocol";
import { memo, type ReactNode } from "react";

import { HastNode, readTree, type HastElement, type HastNode as HastNodeType } from "./hast.tsx";

const HEADING_TAGS = new Set(["h2", "h3", "h4", "h5", "h6"]);

const textOf = (node: HastNodeType): string =>
  node.type === "text" ? node.value : (node.children ?? []).map(textOf).join("");

/** The copy glyph; hidden when the control shows the check. */
const CopyGlyph = () => (
  <svg
    data-mdv-icon="copy"
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="currentColor"
  >
    <path d="M5 1h7a2 2 0 0 1 2 2v7h-2V4a1 1 0 0 0-1-1H5V1Z" />
    <path d="M3 4h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
  </svg>
);

/** The success glyph; the one icon control swaps it in for `data-mdv-state`. */
const CheckGlyph = () => (
  <svg
    data-mdv-icon="check"
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="currentColor"
  >
    <path d="M6.2 13 1.6 8.4l1.5-1.5 3.1 3.1L13 2.9l1.5 1.5L6.2 13Z" />
  </svg>
);

/** An icon-only control: no text, so the name comes from `aria-label` alone. */
const IconControl = ({
  label,
  data,
}: {
  readonly label: string;
  readonly data: Readonly<Record<string, string>>;
}) => (
  <button type="button" className="btn btn-sm btn-square btn-ghost" aria-label={label} {...data}>
    <CopyGlyph />
    <CheckGlyph />
  </button>
);

/** The control is a sibling, so the heading element's bytes and id are untouched. */
const withHeadingControl = (node: HastElement, element: ReactNode): ReactNode => {
  const id = node.properties?.id;
  if (!HEADING_TAGS.has(node.tagName) || typeof id !== "string") return element;

  return (
    <>
      {element}
      <IconControl label={`Copy link to ${textOf(node)}`} data={{ "data-mdv-copy-link": id }} />
    </>
  );
};

/** Only headings carry a control; links are plain links. */
const decorate = (node: HastElement, element: ReactNode): ReactNode =>
  HEADING_TAGS.has(node.tagName) ? withHeadingControl(node, element) : element;

/** One cluster per block that has a payload; the overlay owns no document space. */
const ActionCluster = ({ kind }: { readonly kind: "code" | "table" }) => {
  const attribute = kind === "code" ? "data-mdv-copy-code" : "data-mdv-copy-table";

  return (
    <div data-mdv-actions="true">
      <button
        type="button"
        className="btn btn-sm btn-square btn-ghost"
        aria-label={kind === "code" ? "Copy code" : "Copy table"}
        {...{ [attribute]: "true" }}
      >
        <CopyGlyph />
        <CheckGlyph />
      </button>
    </div>
  );
};

const Block = memo(
  function Block({ block }: { readonly block: WireBlock }) {
    if (block.kind === "frontMatter") return null;
    const tree = readTree(block.hast);
    return (
      <div data-block-id={block.id}>
        {tree?.map((node, index) => (
          <HastNode key={index} node={node} decorate={decorate} />
        ))}
        {block.kind === "code" || block.kind === "table" ? (
          <ActionCluster kind={block.kind} />
        ) : null}
      </div>
    );
  },
  (previous, next) =>
    previous.block.id === next.block.id && previous.block.hash === next.block.hash,
);

/** One keyed element per ordered block. Front matter is hidden. */
export const BlockList = ({
  order,
  blocks,
}: {
  readonly order: readonly BlockId[];
  readonly blocks: ReadonlyMap<BlockId, WireBlock>;
}) => (
  <>
    {order.map((id) => {
      const block = blocks.get(id);
      return block === undefined ? null : <Block key={id} block={block} />;
    })}
  </>
);
