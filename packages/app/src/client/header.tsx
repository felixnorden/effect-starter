import type { RefObject } from "react";

export type HeaderProps = {
  readonly heading: string | null;
  readonly fileName: string | null;
  readonly statusRef?: RefObject<HTMLParagraphElement | null>;
};

/** The slim bar: the document's own name and the live status line. The one
 * control lives at the top of the panel, so the header stays quiet. */
export const Header = ({ heading, fileName, statusRef }: HeaderProps) => (
  <header className="preview-header" role="banner">
    <div className="preview-identity">
      {heading === null ? null : <h1 className="preview-title">{heading}</h1>}
      {fileName === null ? null : <span className="preview-file-name">{fileName}</span>}
    </div>
    <p className="preview-status" aria-live="polite" ref={statusRef} />
  </header>
);
