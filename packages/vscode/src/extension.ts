import * as vscode from 'vscode';
import { loadWorkItemsConfig } from './config.js';
import { buildContextPayload } from './orchestrator.js';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('SCP');

  const disposable = vscode.commands.registerCommand('scp.collectContext', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('SCP: No workspace folder open.');
      return;
    }

    try {
      const workItemsConfig = await loadWorkItemsConfig(context.secrets);
      const payload = await buildContextPayload(
        workspaceFolder.uri.fsPath,
        workItemsConfig,
      );

      outputChannel.appendLine(JSON.stringify(payload, null, 2));
      outputChannel.show();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`SCP: ${message}`);
    }
  });

  context.subscriptions.push(disposable, outputChannel);
  outputChannel.appendLine('SCP extension activated.');
}

export function deactivate(): void {
  // nothing to clean up
}
