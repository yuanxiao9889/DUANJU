import { focusJimengChromeWorkspace as focusJimengChromeWorkspaceCommand } from '@/commands/jimengPanel';

export async function focusJimengChromeWorkspace(): Promise<void> {
  await focusJimengChromeWorkspaceCommand();
}
