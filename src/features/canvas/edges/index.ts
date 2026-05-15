import type { EdgeTypes } from '@xyflow/react';

import { DisconnectableEdge } from './DisconnectableEdge';
import { BranchEdge } from './BranchEdge';
import { OverviewEdge } from './OverviewEdge';

export const edgeTypes: EdgeTypes = {
  disconnectableEdge: DisconnectableEdge,
  branchEdge: BranchEdge,
};

export const overviewEdgeTypes: EdgeTypes = {
  disconnectableEdge: OverviewEdge,
  branchEdge: OverviewEdge,
};
