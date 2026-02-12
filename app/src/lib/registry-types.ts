/**
 * Community Flow Registry types.
 * Shared between the registry panel, GitHub API client, and storage layer.
 */

/** Catalog entry stored in the community repo's index.json */
export interface CommunityFlowMeta {
  id: string;                  // Stable slug (e.g., "tdd-workflow")
  name: string;
  description: string;
  author: string;
  version: string;             // Semver (e.g., "1.0.0")
  stars: number;
  downloads: number;
  tags: string[];
  nodeTypes: string[];         // Node kinds used in the flow
  nodeCount: number;
  createdAt: string;           // ISO 8601
  updatedAt: string;           // ISO 8601
  flowPath: string;            // Relative path (e.g., "flows/tdd-workflow/flow.json")
}

/** Tracks which community flows have been installed locally */
export interface InstalledCommunityFlow {
  communityId: string;         // Matches CommunityFlowMeta.id
  localFlowId: string;         // UUID of the local FlowDefinition in the flows table
  installedVersion: string;    // Version at time of install
  installedAt: number;         // Epoch ms
}

/** Payload assembled when publishing a flow to the community */
export interface PublishFlowPayload {
  slug: string;
  meta: CommunityFlowMeta;
  flowJson: string;            // Stringified FlowDefinition
}
