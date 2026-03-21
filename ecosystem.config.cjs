module.exports = {
  apps: [
    {
      name: 'job-alert-bot',
      script: 'src/index.js',
      interpreter: 'node',
      node_args: '--enable-source-maps',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      watch: false,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
    },
  ],
};
