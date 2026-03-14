// src/common/utils/audience.regex.ts
import { ConfigService } from '@nestjs/config';

export function getAudienceRegex(config: ConfigService, workspaceId?: string): RegExp {
  const domain = config.get('DOMAIN');
  const environment = config.get('NODE_ENV');
  const configWorkspaceId = config.get('WORKSPACE_ID');

  // Use provided workspaceId or fall back to config
  const effectiveWorkspaceId = workspaceId || configWorkspaceId;

  if (environment === 'development') {
    // Match:
    // 1. Localhost with optional port
    // 2. 127.0.0.1 with optional port
    // 3. Postman
    // 4. The workspace ID directly (UUID) for development
    return new RegExp(`(localhost|127\\.0\\.0\\.1)(:\\d+)?|postman|${effectiveWorkspaceId}`);
  }

  // In production, match the exact workspaceId.domain pattern
  if (!effectiveWorkspaceId || !domain) {
    throw new Error('WORKSPACE_ID and DOMAIN must be configured in production');
  }

  return new RegExp(`^${effectiveWorkspaceId}\\.${domain}$`);
}
