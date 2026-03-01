import { describe, it, expect } from 'vitest';
import { parseFileList, parseUnmergedFiles } from '../src/parsers.js';

describe('parseFileList', () => {
  it('splits newline-separated paths into unique entries', () => {
    const output = 'src/foo.ts\nsrc/bar.ts\nsrc/foo.ts';
    expect(parseFileList(output)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('trims whitespace from lines', () => {
    const output = '  src/foo.ts  \n  src/bar.ts  ';
    expect(parseFileList(output)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('filters out empty lines', () => {
    const output = 'src/foo.ts\n\n\nsrc/bar.ts\n';
    expect(parseFileList(output)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('returns empty array for empty input', () => {
    expect(parseFileList('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseFileList('  \n  \n  ')).toEqual([]);
  });
});

describe('parseUnmergedFiles', () => {
  it('extracts unique file paths from git ls-files --unmerged output', () => {
    const output = [
      '100644 abc123 1\tsrc/conflict.ts',
      '100644 def456 2\tsrc/conflict.ts',
      '100644 ghi789 3\tsrc/conflict.ts',
      '100644 jkl012 1\tsrc/other.ts',
      '100644 mno345 2\tsrc/other.ts',
    ].join('\n');

    expect(parseUnmergedFiles(output)).toEqual(['src/conflict.ts', 'src/other.ts']);
  });

  it('returns empty array for no conflicts', () => {
    expect(parseUnmergedFiles('')).toEqual([]);
  });

  it('handles single conflict file', () => {
    const output = '100644 abc123 1\tsrc/single.ts';
    expect(parseUnmergedFiles(output)).toEqual(['src/single.ts']);
  });
});
