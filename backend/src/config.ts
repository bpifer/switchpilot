function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.API_PORT ?? '3000', 10),
  // Comma-separated allowed CORS origins; unset = reflect any origin (dev convenience).
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : null,
  // Serve Swagger UI at /docs. Default on; set ENABLE_API_DOCS=false to hide the schema in prod.
  enableDocs: process.env.ENABLE_API_DOCS !== 'false',
  // Optional bearer token guarding GET /metrics. Unset = open (scrape on a trusted
  // network); set it and Prometheus must send `Authorization: Bearer <token>`.
  metricsToken: process.env.METRICS_TOKEN ?? '',
  db: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database: process.env.POSTGRES_DB ?? 'switchpilot',
    user: process.env.POSTGRES_USER ?? 'switchpilot',
    password: req('POSTGRES_PASSWORD', 'switchpilot')
  },
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: req('JWT_SECRET', 'dev-only-secret'),
  jwtExpires: process.env.JWT_EXPIRES ?? '8h',
  // 32-byte hex key for AES-256-GCM credential encryption
  credentialKey: req('CREDENTIAL_KEY', '00'.repeat(32)),
  poll: {
    statusIntervalSec: parseInt(process.env.POLL_STATUS_INTERVAL ?? '60', 10),
    metricsIntervalSec: parseInt(process.env.POLL_METRICS_INTERVAL ?? '300', 10),
    backupCron: process.env.BACKUP_CRON ?? '0 2 * * *',
    complianceCron: process.env.COMPLIANCE_CRON ?? '*/15 * * * *'
  },
  retention: {
    metricsDays: parseInt(process.env.RETAIN_METRICS_DAYS ?? '400', 10),
    portMetricsDays: parseInt(process.env.RETAIN_PORT_METRICS_DAYS ?? '90', 10),
    clientDays: parseInt(process.env.RETAIN_CLIENTS_DAYS ?? '365', 10),
    alertDays: parseInt(process.env.RETAIN_ALERTS_DAYS ?? '90', 10),
    syslogDays: parseInt(process.env.RETAIN_SYSLOG_DAYS ?? '14', 10)
  },
  firmwareDir: process.env.FIRMWARE_DIR ?? '/data/firmware',
  configHistoryDir: process.env.CONFIG_HISTORY_DIR ?? '/data/config-history',
  // Optional external git remote to mirror the config-history repo to (off-box DR).
  // Unset = no mirror. Use a dedicated remote; see .env.example for auth options.
  configHistoryRemote: process.env.CONFIG_HISTORY_REMOTE ?? '',
  syslogPort: parseInt(process.env.SYSLOG_PORT ?? '514', 10),
  netflow: {
    // UDP NetFlow/IPFIX collector. Off by default; point exporters (Cisco
    // NetFlow / MikroTik traffic-flow) at this host:port to populate Traffic.
    enabled: process.env.NETFLOW_ENABLED === 'true',
    port: parseInt(process.env.NETFLOW_PORT ?? '2055', 10),
    retentionDays: parseInt(process.env.NETFLOW_RETAIN_DAYS ?? '30', 10),
  },
  certCheck: {
    // Daily TLS-cert expiry check against each device's management port. Reads
    // the presented cert (no auth); devices that don't speak TLS are skipped.
    enabled: process.env.CERT_CHECK_ENABLED !== 'false',
    port: parseInt(process.env.CERT_CHECK_PORT ?? '443', 10),
    warnDays: parseInt(process.env.CERT_EXPIRY_WARN_DAYS ?? '30', 10),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'switchpilot@localhost'
  },
  teamsWebhook: process.env.TEAMS_WEBHOOK_URL ?? '',
  slackWebhook: process.env.SLACK_WEBHOOK_URL ?? '',
  discordWebhook: process.env.DISCORD_WEBHOOK_URL ?? '',
  ntfy: {
    url: process.env.NTFY_URL ?? '',        // full topic URL, e.g. https://ntfy.sh/my-switches
    token: process.env.NTFY_TOKEN ?? ''     // optional, for protected topics
  },
  gotify: {
    url: process.env.GOTIFY_URL ?? '',      // base, e.g. https://gotify.example.com
    token: process.env.GOTIFY_TOKEN ?? ''
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? ''
  },
  pushover: {
    token: process.env.PUSHOVER_TOKEN ?? '',
    user: process.env.PUSHOVER_USER ?? ''
  },
  ldap: {
    url: process.env.LDAP_URL ?? '',
    bindDn: process.env.LDAP_BIND_DN ?? '',
    bindPassword: process.env.LDAP_BIND_PASSWORD ?? '',
    searchBase: process.env.LDAP_SEARCH_BASE ?? '',
    groupRoleMap: {
      superadmin: process.env.LDAP_GROUP_SUPERADMIN ?? '',
      netadmin: process.env.LDAP_GROUP_NETADMIN ?? '',
      helpdesk: process.env.LDAP_GROUP_HELPDESK ?? '',
      readonly: process.env.LDAP_GROUP_READONLY ?? ''
    } as Record<string, string>
  }
};
