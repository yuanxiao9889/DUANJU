import { inspectJimengPanelOptions } from '@/commands/jimengPanel';

import type { JimengInspectionReport } from '@/features/jimeng/domain/jimengInspection';

export async function fetchJimengInspectionReport(): Promise<JimengInspectionReport> {
  return await inspectJimengPanelOptions<JimengInspectionReport>();
}
