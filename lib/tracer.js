import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import pjson from '../package.json' with { type: 'json' };

export const maybeSetupTracing = () => {
  if (canEnableTracing()) {
    setupTracing();
  }
};

const canEnableTracing = () => {
  // OTEL SDKs should honor the OTEL_SDK_DISABLED variable, but we don't lose anything by being extra paranoid
  if ((process.env.OTEL_SDK_DISABLED ?? '').toLowerCase() !== 'true') {
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
    const otlpProtocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? '';

    if (otlpEndpoint !== '') {
      try {
        new URL(otlpEndpoint);
      } catch {
        console.warn('OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL, tracing will be disabled');
        return false;
      }
    } else {
      console.warn('OTEL_EXPORTER_OTLP_ENDPOINT is not set, tracing will be disabled');
      return false;
    }

    if (otlpProtocol === '') {
      console.warn('OTEL_EXPORTER_OTLP_PROTOCOL is not set, tracing will be disabled');
      return false;
    }

    return true;
  }

  return false;
};

const setupTracing = () => {
  if (!canEnableTracing()) {
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'unknown_service';
  const bufferConfig = {
    maxExportBatchSize: process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE
      ? parseInt(process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE)
      : 512,
    scheduledDelayMillis: process.env.OTEL_BSP_SCHEDULE_DELAY ? parseInt(process.env.OTEL_BSP_SCHEDULE_DELAY) : 10_000,
    exportTimeoutMillis: process.env.OTEL_BSP_EXPORT_TIMEOUT ? parseInt(process.env.OTEL_BSP_EXPORT_TIMEOUT) : 60_000,
    maxQueueSize: process.env.OTEL_BSP_MAX_QUEUE_SIZE ? parseInt(process.env.OTEL_BSP_MAX_QUEUE_SIZE) : 2_048,
  };
  const exporter = new OTLPTraceExporter();
  const spanProcessor = new BatchSpanProcessor(exporter, bufferConfig);
  const tracerProvider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      ['service.namespace']: pjson.name,
    }),
    spanProcessors: [spanProcessor],
  });
  tracerProvider.register();

  registerInstrumentations({
    tracerProvider: tracerProvider,
    instrumentations: [
      // Express instrumentation expects HTTP layer to be instrumented
      new HttpInstrumentation(),
      new ExpressInstrumentation({
        ignoreLayersType: [ExpressLayerType.ROUTER],
        ignoreLayers: [
          /helmetMiddleware/, // We don't want to trace Helmet middleware
          /jsonParser/, // We don't want to trace JSON parsing middleware
          /logger/, // We don't want to trace logging middleware
        ]
      })
    ],
  });
}
