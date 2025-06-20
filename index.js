import '@dotenvx/dotenvx/config';

// We need to setup tracing before loading Express, otherwise the Express instrumentation will not be applied
import { maybeSetupTracing } from './lib/tracer.js';
maybeSetupTracing();

import server from './lib/server.js';

server(process.env);
