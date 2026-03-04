module.exports = {
  apps: [
    {
      name: 'media-service',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
      },
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/pm2/media-service-error.log',
      out_file: '/var/log/pm2/media-service-out.log',
      merge_logs: true,
    },
  ],
};
