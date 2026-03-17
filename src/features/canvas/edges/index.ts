import type { EdgeTypes } from '@xyflow/react';

import { DisconnectableEdge } from './DisconnectableEdge';
import { BranchEdge } from './BranchEdge';

export const edgeTypes: EdgeTypes = {
  disconnectableEdge: DisconnectableEdge,
  branchEdge: BranchEdge,
};
