/**
 * @file logger.js
 * @description Central structured logging for DocuAlign. Every event carries a
 * consistent shape (timestamp, level, session id, page, message, plus caller
 * context such as feature/function/operation/category) so console output is
 * searchable and a future remote sink can subscribe without touching call
 * sites. Also keeps a small in-memory buffer of recent events for support
 * diagnostics and provides a correlated async operation lifecycle for latency
 * and in-flight work visibility.
 */

export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

// Map view of LOG_LEVELS so lookups by caller-supplied strings avoid dynamic
// object property access (flagged by security/detect-object-injection).
const LEVEL_RANKS = new Map(Object.entries(LOG_LEVELS));

// Resolved at call time so test spies on console methods are honoured.
function consoleMethodFor(level) {
  if (level === "debug") return console.debug;
  if (level === "warn") return console.warn;
  if (level === "error") return console.error;
  return console.info;
}

// Correlates every event emitted during one page load. Purely random — carries
// no user information — so it is safe to share in a support screenshot.
export const sessionId = Math.random().toString(36).slice(2, 10);

const RECENT_EVENT_LIMIT = 50;
const DEFAULT_SLOW_OPERATION_THRESHOLD_MS = 3000;
const recentEvents = [];
const subscribers = new Set();
const activeOperations = new Map();

let minimumLevel = LOG_LEVELS.info;
let eventSequence = 0;
let operationSequence = 0;

/**
 * Raise or lower the minimum level that reaches the console and buffer.
 * @param {"debug"|"info"|"warn"|"error"} level
 */
export function setMinimumLogLevel(level) {
  if (!LEVEL_RANKS.has(level)) {
    throw new TypeError(`Unknown log level: ${level}`);
  }
  minimumLevel = LEVEL_RANKS.get(level);
}

/**
 * Subscribe to every emitted log event (e.g. to forward errors to a remote
 * sink). Subscriber failures are swallowed so logging can never break the app.
 * @param {(event: object) => void} subscriber
 * @returns {() => void} Unsubscribe function.
 */
export function onLogEvent(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

/**
 * Recent events (newest last) for support diagnostics — e.g. attaching the
 * tail of the log to a bug report without asking users to open devtools.
 * @returns {object[]} Copies of the buffered events.
 */
export function getRecentEvents() {
  return recentEvents.map((event) => ({ ...event }));
}

export function clearRecentEvents() {
  recentEvents.length = 0;
}

/**
 * Return unfinished tracked operations with their current elapsed time. Internal
 * monotonic timestamps are omitted so the snapshot remains serializable.
 * @returns {object[]} Copies of active operation descriptors.
 */
export function getActiveOperations() {
  const now = performance.now();
  return [...activeOperations.values()].map(
    ({ startedAtMonotonic, ...operation }) => ({
      ...operation,
      activeForMs: Math.max(0, Math.round(now - startedAtMonotonic)),
    }),
  );
}

// Normalise a thrown value into loggable fields without assuming Error shape.
function describeError(error) {
  if (!error) return {};
  return {
    errorCode: error.code ?? undefined,
    errorMessage: error.message ?? String(error),
  };
}

function emit(level, message, context, error) {
  if (LEVEL_RANKS.get(level) < minimumLevel) return;
  eventSequence += 1;

  // Caller context is intentionally applied first. The logger owns the core
  // identity fields so an accidental `message`, `level`, or `sessionId` key at
  // a call site cannot corrupt filtering and correlation downstream.
  const event = Object.freeze({
    ...context,
    ...describeError(error),
    feature: context.feature ?? "Application",
    function: context.function ?? "unknown",
    operation: context.operation ?? "unknown",
    category: context.category ?? "General",
    timestamp: new Date().toISOString(),
    sequence: eventSequence,
    level,
    sessionId,
    page: globalThis.location?.pathname ?? "unknown",
    message,
  });

  recentEvents.push(event);
  if (recentEvents.length > RECENT_EVENT_LIMIT) recentEvents.shift();

  const consoleMethod = consoleMethodFor(level);
  if (error) {
    consoleMethod(`[DocuAlign] ${message}`, error, event);
  } else {
    consoleMethod(`[DocuAlign] ${message}`, event);
  }

  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // A broken subscriber must never take down logging or the app.
    }
  }
}

export function logDebug(message, context = {}) {
  emit("debug", message, context);
}

export function logInfo(message, context = {}) {
  emit("info", message, context);
}

export function logWarn(message, errorOrContext = {}, context) {
  if (context) {
    emit("warn", message, context, errorOrContext);
    return;
  }
  emit("warn", message, errorOrContext);
}

/**
 * @param {string} message - Human-readable summary of the failure.
 * @param {unknown} [error] - The thrown value, logged alongside the event.
 * @param {object} [context] - feature/function/operation/category fields.
 */
export function logError(message, error, context = {}) {
  emit("error", message, context, error);
}

/**
 * Time an async operation and log its lifecycle: a start event followed by an
 * info event with durationMs on success or an error event (then rethrow) on
 * failure. Both events share an operationId for correlation.
 * @template T
 * @param {string} message - Summary used for both the success and failure event.
 * @param {object} context - feature/function/operation/category fields.
 * @param {() => Promise<T>} operation
 * @param {{expectedErrorCodes?: string[], slowThresholdMs?: number}} [options]
 * Error codes that are expected rejections rather than application failures,
 * plus the duration after which a successful operation emits a warning.
 * @returns {Promise<T>} The operation's result.
 */
export async function trackOperation(message, context, operation, options = {}) {
  operationSequence += 1;
  const operationId = `${sessionId}-${operationSequence}`;
  const startedAt = performance.now();
  const activeOperation = Object.freeze({
    ...context,
    feature: context.feature ?? "Application",
    function: context.function ?? "unknown",
    operation: context.operation ?? "unknown",
    category: context.category ?? "OperationLifecycle",
    message,
    operationId,
    startedAt: new Date().toISOString(),
    startedAtMonotonic: startedAt,
  });
  activeOperations.set(operationId, activeOperation);
  logInfo(`${message} started`, {
    ...context,
    operationId,
    outcome: "started",
    category: context.category ?? "OperationLifecycle",
  });

  try {
    const result = await operation();
    const durationMs = Math.round(performance.now() - startedAt);
    activeOperations.delete(operationId);
    logInfo(`${message} succeeded`, {
      ...context,
      operationId,
      durationMs,
      outcome: "success",
      category: context.category ?? "OperationLifecycle",
    });
    const slowThresholdMs =
      options.slowThresholdMs ?? DEFAULT_SLOW_OPERATION_THRESHOLD_MS;
    if (durationMs >= slowThresholdMs) {
      logWarn(`${message} was slow`, {
        ...context,
        operationId,
        durationMs,
        outcome: "success",
        slowThresholdMs,
        category: "SlowOperation",
      });
    }
    return result;
  } catch (error) {
    activeOperations.delete(operationId);
    const expected = (options.expectedErrorCodes ?? []).includes(error?.code);
    const failureContext = {
      ...context,
      operationId,
      category: context.category ?? error?.code ?? "OperationFailure",
      durationMs: Math.round(performance.now() - startedAt),
      outcome: expected ? "rejected" : "failure",
    };

    if (expected) {
      logWarn(`${message} rejected`, {
        ...failureContext,
        ...describeError(error),
      });
    } else {
      logError(`${message} failed`, error, failureContext);
    }
    throw error;
  }
}
