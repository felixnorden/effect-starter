import { EDITOR_PROTOCOL_VERSION } from "@mdv/core/editor-protocol";

/** The three values the version mode prints, in one fixed order. */
export interface VersionValues {
  readonly packageVersion: string | null;
  readonly bunVersion: string | null;
  readonly editorProtocolVersion: number | null;
}

const line = (label: string, value: string | number | null): string | null =>
  value === null || value === "" ? null : `${label} ${value}`;

/** Three lines, or `null` when a value cannot be resolved. */
export const formatVersion = (values: VersionValues): string | null => {
  const lines = [
    line("package", values.packageVersion),
    line("bun", values.bunVersion),
    line("wire", values.editorProtocolVersion),
  ];
  return lines.every((entry) => entry !== null) ? lines.join("\n") : null;
};

/** The values this process can resolve; absent values stay `null`. */
export const currentVersion = (
  packageVersion: string | null,
  bunVersion: string | null,
): VersionValues => ({
  packageVersion,
  bunVersion,
  editorProtocolVersion: EDITOR_PROTOCOL_VERSION,
});

export const VERSION_FAILURE =
  "Markdown Viewer: cannot resolve the package version, Bun version, or editor wire version.";
