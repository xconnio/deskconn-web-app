/**
 * Line-granular diff for the editor's added/modified line coloring, built on
 * diff-match-patch's line-mode helpers (already a dependency — see textPatch.ts):
 * diff_linesToChars_ collapses each line to one token so diff_main operates at
 * line granularity instead of character granularity, then diff_charsToLines_
 * expands the result back to real line text.
 */
import DiffMatchPatch from 'diff-match-patch'

export type LineDiffKind = 'added' | 'modified'
/** 1-based line number (in `current`) -> classification. */
export type LineDiffMap = Map<number, LineDiffKind>

// Diffing every keystroke on a huge file is wasted work the user will never
// see land before their next keystroke invalidates it.
// ponytail: flat size cap, not a debounce/worker — upgrade path if typing in
// large files ever feels janky.
const MAX_DIFF_SIZE = 2 * 1024 * 1024

function lineCount(text: string): number {
  if (text === '') return 0
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}

export function computeLineDiff(original: string, current: string): LineDiffMap {
  const map: LineDiffMap = new Map()
  if (original === current) return map
  if (original.length > MAX_DIFF_SIZE || current.length > MAX_DIFF_SIZE) return map

  const dmp = new DiffMatchPatch()
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(original, current)
  // No diff_cleanupSemantic here: it merges small equal spans sandwiched
  // between edits into the surrounding change for readability, which would
  // mark an untouched line 'modified' just for sitting next to a real edit.
  // The raw line-mode diff already gives the precise minimal edit we want.
  const diffs = dmp.diff_main(chars1, chars2, false)
  dmp.diff_charsToLines_(diffs, lineArray)

  let curLine = 1
  let prevOp: number | null = null
  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      curLine += lineCount(text)
    } else if (op === DiffMatchPatch.DIFF_INSERT) {
      const n = lineCount(text)
      const kind: LineDiffKind = prevOp === DiffMatchPatch.DIFF_DELETE ? 'modified' : 'added'
      for (let i = 0; i < n; i++) map.set(curLine + i, kind)
      curLine += n
    }
    // DIFF_DELETE: text no longer exists in `current`, nothing to color.
    prevOp = op
  }

  return map
}
