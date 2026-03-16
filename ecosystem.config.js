module.exports = {
    apps: [
        {
            name: 'alertastrabajos-bot',
            script: './index.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            max_restarts: 20,
            min_uptime: '15s',
            restart_delay: 5000,
            max_memory_restart: '300M',
            watch: false,
            out_file: './logs/out.log',
            error_file: './logs/error.log',
            merge_logs: true,
            time: true,
            env: {
                NODE_ENV: 'production',
                BOT_TIMEZONE: 'America/Santiago',
            },
        },
    ],
};
