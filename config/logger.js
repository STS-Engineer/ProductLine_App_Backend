const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    serializers: { err: pino.stdSerializers.err },
    // Never let JWTs/cookies land in logs via the automatic per-request logging (pino-http)
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    transport:
        process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

module.exports = logger;
