/** Mirror qmd's documented display-path normalization for public tool calls. */
export function qmdDisplayPath(path: string): string {
  const emojiToHex = (value: string) =>
    value.replace(/(?:\p{So}\p{Mn}?|\p{Sk})+/gu, (run) =>
      [...run]
        .filter((character) => /\p{So}|\p{Sk}/u.test(character))
        .map((character) => character.codePointAt(0)?.toString(16) ?? "")
        .filter(Boolean)
        .join("-"),
    );
  return path
    .replace(/___/g, "/")
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .map((rawSegment, index, segments) => {
      const segment = emojiToHex(rawSegment);
      const isFile = index === segments.length - 1;
      const extension = isFile ? (segment.match(/(\.[a-z0-9]+)$/i)?.[1] ?? "") : "";
      const name = extension ? segment.slice(0, -extension.length) : segment;
      const cleaned = name.replace(/[^\p{L}\p{N}$]+/gu, "-").replace(/^-+|-+$/g, "");
      return `${cleaned}${extension}`;
    })
    .filter(Boolean)
    .join("/");
}
