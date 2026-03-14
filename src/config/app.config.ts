import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsEnabled: process.env.CORS_ENABLED === 'true',
  corsOrigin: process.env.CORS_ORIGIN?.split(',').map(o => o.trim()).filter(Boolean) || ['http://localhost:3000'],
}));
