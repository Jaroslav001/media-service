export default () => ({
  port: parseInt(process.env.PORT ?? '3003', 10) || 3003,
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379,
    db: parseInt(process.env.REDIS_DB ?? '2', 10) || 2,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  s3: {
    region: process.env.S3_REGION || 'fra1',
    endpoint: process.env.S3_ENDPOINT || 'https://fra1.digitaloceanspaces.com',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET || 'acko',
    cdnUrl: process.env.S3_CDN_URL || '',
  },
  webhook: {
    defaultUrl: process.env.WEBHOOK_DEFAULT_URL || '',
    secret: process.env.WEBHOOK_SECRET || '',
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || '').split(','),
  },
});
