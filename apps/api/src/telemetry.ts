import type { Env } from "@partner-coder/config";

export interface Telemetry {
  captureException(error: unknown): void;
  shutdown(): Promise<void>;
}

type SentryLike = {
  captureException(error: unknown): void;
};

type SdkLike = {
  start(): void | Promise<void>;
  shutdown(): Promise<void>;
};

export async function initTelemetry(
  env: Env,
  options: { readonly serviceName: string; readonly version: string },
): Promise<Telemetry> {
  let sdk: SdkLike | undefined;
  let sentry: SentryLike | undefined;

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const base = env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "");
    process.env.OTEL_SERVICE_NAME ??= options.serviceName;
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { getNodeAutoInstrumentations } =
      await import("@opentelemetry/auto-instrumentations-node");
    sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });
    await sdk.start();
  }

  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.APP_ENV,
      release: options.version,
      tracesSampleRate: 0,
    });
    sentry = {
      captureException(error) {
        Sentry.captureException(error);
      },
    };
  }

  return {
    captureException(error) {
      sentry?.captureException(error);
    },
    async shutdown() {
      await sdk?.shutdown();
    },
  };
}
