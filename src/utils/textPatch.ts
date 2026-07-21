/** Mirrors fileexplorer.go's BuildEditPatch exactly, so the patch text parses cleanly server-side. */
import DiffMatchPatch from 'diff-match-patch'

export function buildEditPatch(original: string, edited: string): string {
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(original, edited, false)
  const patches = dmp.patch_make(original, diffs)
  return dmp.patch_toText(patches)
}
