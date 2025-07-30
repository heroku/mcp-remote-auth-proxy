import '@dotenvx/dotenvx/config';
import './telemetry.js';

import server from './lib/server.js';

server(process.env);
