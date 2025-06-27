import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

register('@opentelemetry/instrumentation/hook.mjs', pathToFileURL('./'));

console.log('--------------------------------');
console.log('telemetry.js');
console.log('--------------------------------');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
    })
  ],
});

sdk.start();
