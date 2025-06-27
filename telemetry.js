import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new NetInstrumentation(),
    new UndiciInstrumentation(),
    new RedisInstrumentation(),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.info('Tracing terminated'))
    .catch((err) => console.error('Error terminating tracing', err))
});