// Opt-in OpenTelemetry tracing. Does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT
// is set, in which case HTTP requests, pg queries, redis commands, and DNS
// lookups are auto-instrumented and exported via OTLP/HTTP (Jaeger, Tempo,
// Datadog agent, etc.). Must be imported before anything else in index.ts so
// the instrumentation patches land before the libraries are loaded.
export async function startTracing(): Promise<void> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'switchpilot-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations({
      // fs instrumentation is extremely chatty and rarely useful here
      '@opentelemetry/instrumentation-fs': { enabled: false }
    })]
  });
  sdk.start();
  console.log('[otel] tracing enabled, exporting to', process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  process.on('SIGTERM', () => { sdk.shutdown().catch(() => { /* best effort */ }); });
}
