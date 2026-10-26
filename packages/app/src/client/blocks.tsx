import type { BlockId, WireBlock } from "@mdv/core/protocol";
import { memo } from "react";

import { HastNode, readTree } from "./hast.tsx";

const Block = memo(
  function Block({ block }: { readonly block: WireBlock }) {
    if (block.kind === "frontMatter") return null;
    const tree = readTree(block.hast);
    return (
      <div data-block-id={block.id}>
        {tree?.map((node, index) => (
          <HastNode key={index} node={node} />
        ))}
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
