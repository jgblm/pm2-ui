/**
 * PM2 生态配置示例
 * 用法：
 *   pm2 start ecosystem.config.js          # 启动管理台自身
 *   pm2 start ecosystem.config.js --only pm2-ui
 */
module.exports = {
  apps: [
    {
      name: 'pm2-ui',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PM2_WEB_PORT: 7799,
        PM2_WEB_HOST: '127.0.0.1',
      },
      error_file: './logs/manager-error.log',
      out_file: './logs/manager-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
