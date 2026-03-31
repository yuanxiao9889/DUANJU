import { focusJimengChromeWorkspace as focusJimengChromeWorkspaceCommand } from '@/commands/jimengPanel';

export async function focusJimengChromeWorkspace(
  creationType?: string
): Promise<void> {
  await focusJimengChromeWorkspaceCommand(
    creationType ? { creationType } : undefined
  );
}
