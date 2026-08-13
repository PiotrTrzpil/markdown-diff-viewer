/**
 * Subpath re-export: `markdown-diff-viewer/git` (Node only — uses child_process).
 * @module
 */
export {
  getGitRoot,
  isGitRepo,
  getGitFileContent,
  getStagedContent,
  type ChangedFile,
  getChangedMdFilesWithRenames,
  getStagedMdFilesWithRenames,
  getUntrackedMdFiles,
  type PrInfo,
  getPrInfo,
  fetchRefs,
  findOldPath,
  expandGitShortcut,
} from "./git/index.js";
