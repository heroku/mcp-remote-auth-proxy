import winston from 'winston';

// Get environment variables for app name and environment
const APP_NAME    = process.env.APP_NAME || 'mcp-heroku-com';
const ENVIRONMENT = process.env.NODE_ENV || process.env.ENVIRONMENT || 'development';
const LOG_LEVEL   = process.env.LOG_LEVEL || 'info';

const splunkFormat = winston.format.printf(({ timestamp, ...meta }) => {
  const keyValues = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
  return `${timestamp} ${keyValues.join(' ')}`;
});

// Create the Winston logger
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.timestamp(),
  defaultMeta: {
    app: APP_NAME,
    environment: ENVIRONMENT,
    proxy: true
  },
  transports: [
    new winston.transports.Console({
      format: splunkFormat
    })
  ]
});

// Helper function to create a logger with request context
export function createRequestLogger(req) {
  const requestId = req?.headers?.['x-request-id'] || 
                   req?.get?.('x-request-id') || 
                   req?.request?.headers?.['x-request-id'] ||
                   'unknown';
  
  return logger.child({ 
    'request-id': requestId,
    method: req?.method || 'unknown',
    path: req?.path || 'unknown'
  });
}

// Export the base logger for cases where there's no request context
export default logger; 