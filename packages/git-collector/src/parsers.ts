/** Split newline-separated output into unique non-empty file paths. */
export function parseFileList(output: string): string[] {
  return [...new Set(
    output.split('\n').map(l => l.trim()).filter(Boolean)
  )];
}

/** Parse `git ls-files --unmerged` output into conflict file paths. */
export function parseUnmergedFiles(output: string): string[] {
  // Each line: <mode> <hash> <stage>\t<path>
  const paths = output
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('\t')[1])
    .filter((p): p is string => p !== undefined);
  return [...new Set(paths)];
}
