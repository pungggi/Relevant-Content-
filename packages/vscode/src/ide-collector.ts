import * as vscode from 'vscode';
import type { IDEContext } from '@scp/core';

/**
 * Collect IDE telemetry signals from the current VS Code state.
 *
 * This function is synchronous — all data comes from VS Code's
 * in-memory state, no async IO needed.
 */
export function collectIDEContext(): IDEContext {
  const editor = vscode.window.activeTextEditor;

  // Active file → activeNodeId
  const activeNodeId = editor
    ? filePathToNodeId(editor.document.uri.fsPath)
    : undefined;

  // Open tabs → openTabNodeIds
  const openTabNodeIds = vscode.window.tabGroups.all
    .flatMap(group => group.tabs)
    .map(tab => {
      const uri = (tab.input as { uri?: vscode.Uri })?.uri;
      return uri ? filePathToNodeId(uri.fsPath) : null;
    })
    .filter((id): id is string => id !== null);

  // Breakpoints → breakpointNodeIds
  const breakpointNodeIds = vscode.debug.breakpoints
    .filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint)
    .map(bp => filePathToNodeId(bp.location.uri.fsPath));

  // Visible files
  const visibleFiles = vscode.window.visibleTextEditors
    .map(e => e.document.uri.fsPath);

  // Diagnostics (errors and warnings only)
  const diagnostics = vscode.languages.getDiagnostics()
    .flatMap(([uri, diags]) =>
      diags
        .filter(d => d.severity <= vscode.DiagnosticSeverity.Warning)
        .map(d => ({
          nodeId: filePathToNodeId(uri.fsPath),
          message: d.message,
        }))
    );

  return { activeNodeId, openTabNodeIds, breakpointNodeIds, visibleFiles, diagnostics };
}

/** Convert a file path to an SDL-MCP node ID format. */
function filePathToNodeId(fsPath: string): string {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    return vscode.workspace.asRelativePath(fsPath);
  }
  return fsPath;
}
