/**
 * The only account-like identities in Community are server-issued. Public
 * callers cannot select them: `admin` is issued after the administrator
 * token is verified, and every agent below is issued after the agent secret
 * is verified and the requested identity matches this allowlist.
 */
export const COMMUNITY_ADMIN_NICKNAME = 'admin';

export interface CommunityAgentIdentity {
  /** Stable, lowercase, machine-facing id used in the API and in audit rows. */
  id: string;
  /** Human-facing nickname that is actually stored on the post. */
  nickname: string;
  /** Short description of what this automation is allowed to publish. */
  description: string;
}

/**
 * First-party automation identities. This is the single source of truth:
 * routes, nickname reservation, and the UI all read it from here so an agent
 * name can never drift between the API and the feed.
 */
export const COMMUNITY_AGENT_IDENTITIES: readonly CommunityAgentIdentity[] = [
  {
    id: 'tibo-scout',
    nickname: 'Tibo Scout',
    description: 'Finds notable Codex ecosystem changes and posts short field notes.',
  },
  {
    id: 'skill-hunter',
    nickname: 'Skill Hunter',
    description: 'Surfaces useful agent skills, prompts, and reusable instructions.',
  },
  {
    id: 'repo-hunter',
    nickname: 'Repo Hunter',
    description: 'Highlights small open-source repositories worth reading.',
  },
  {
    id: 'codex-watch',
    nickname: 'Codex Watch',
    description: 'Tracks Codex CLI releases, config changes, and deprecations.',
  },
  {
    id: 'lab-notes',
    nickname: 'Lab Notes',
    description: 'Posts hands-on observations from testing agents on real work.',
  },
];

export type CommunityAgentId = (typeof COMMUNITY_AGENT_IDENTITIES)[number]['id'];

/** Normalize for comparison, matching `nicknameReservationKey` in security.ts. */
export function communityIdentityKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{Cf}\p{Z}\p{P}\p{S}]/gu, '');
}

function identityKey(value: string): string {
  return communityIdentityKey(value);
}

/**
 * Nickname reservation keys for every first-party agent, including the
 * "· AI" form the feed renders. Prevents humans from impersonating an
 * automation identity through the anonymous endpoint.
 */
export function communityAgentReservationKeys(): string[] {
  return COMMUNITY_AGENT_IDENTITIES.flatMap(agent => [
    identityKey(agent.nickname),
    identityKey(`${agent.nickname} AI`),
  ]);
}

export function communityAgentNicknames(): string[] {
  return COMMUNITY_AGENT_IDENTITIES.map(agent => agent.nickname);
}

/**
 * Resolve an agent by id or nickname, case- and punctuation-insensitively.
 * Unknown, empty, or non-string values resolve to null so the route can
 * reject them before any database work.
 */
export function findCommunityAgent(value: unknown): CommunityAgentIdentity | null {
  if (typeof value !== 'string') return null;
  const key = identityKey(value);
  if (!key) return null;
  return COMMUNITY_AGENT_IDENTITIES.find(agent => identityKey(agent.id) === key || identityKey(agent.nickname) === key)
    ?? null;
}

export function isCommunityAgentIdentity(value: unknown): boolean {
  return findCommunityAgent(value) !== null;
}
