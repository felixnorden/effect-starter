import type { BlockId, WireBlock } from "@mdv/core/protocol";
import { memo, type ReactNode } from "react";

import { HastNode, readTree, type HastElement, type HastNode as HastNodeType } from "./hast.tsx";

const HEADING_TAGS = new Set(["h2", "h3", "h4", "h5", "h6"]);

const headingText = (node: HastNodeType): string =>
  node.type === "text" ? node.value : (node.children ?? []).map(headingText).join("");

/** The control is a sibling, so the heading element's bytes and id are untouched. */
const withHeadingControl = (node: HastElement, element: ReactNode): ReactNode => {
  const id = node.properties?.id;
  if (!HEADING_TAGS.has(node.tagName) || typeof id !== "string") return element;

  return (
    <>
      {element}
      <button
        type="button"
        data-mdv-copy-link={id}
        aria-label={`Copy link to ${headingText(node)}`}
      >
        Link
      </button>
    </>
  );
};

const Block = memo(
  function Block({ block }: { readonly block: WireBlock }) {
    if (block.kind === "frontMatter") return null;
    const tree = readTree(block.hast);
    return (
      <div data-block-id={block.id}>
        {tree?.map((node, index) => (
          <HastNode key={index} node={node} decorate={withHeadingControl} />
        ))}
        {block.kind === "code" ? (
          <button type="button" data-mdv-copy-code aria-label="Copy code">
            Copy
          </button>
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
