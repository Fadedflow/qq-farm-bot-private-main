const MAX_ENTRIES = 500;

let enabled = false;
let entries = [];
let nextId = 1;
let forwarder = null;
let pendingEntries = [];

function setForwarder(fn) {
  forwarder = fn;
}

function enable() {
  enabled = true;
}

function disable() {
  enabled = false;
}

function isEnabled() {
  return enabled;
}

function getEntries() {
  return entries;
}

function clear() {
  entries = [];
  nextId = 1;
}

function logRequest(accountId, accountName, serviceName, methodName, bodyLength, seq) {
  if (!enabled) return;
  pushEntry({
    type: 'request',
    accountId: String(accountId || ''),
    accountName: String(accountName || ''),
    service: String(serviceName || ''),
    method: String(methodName || ''),
    bodyLength: Number(bodyLength) || 0,
    seq: Number(seq) || 0,
    timestamp: Date.now(),
  });
}

function logResponse(accountId, accountName, seq, service, method, success, errorMessage, bodyLength, elapsedMs) {
  if (!enabled) return;
  pushEntry({
    type: 'response',
    accountId: String(accountId || ''),
    accountName: String(accountName || ''),
    service: String(service || ''),
    method: String(method || ''),
    bodyLength: Number(bodyLength) || 0,
    seq: Number(seq) || 0,
    success: Boolean(success),
    errorMessage: String(errorMessage || ''),
    elapsedMs: Number(elapsedMs) || 0,
    timestamp: Date.now(),
  });
}

function logNotify(accountId, accountName, notifyType) {
  if (!enabled) return;
  pushEntry({
    type: 'notify',
    accountId: String(accountId || ''),
    accountName: String(accountName || ''),
    notifyType: String(notifyType || ''),
    timestamp: Date.now(),
  });
}

function pushEntry(entry) {
  entry.id = nextId++;
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
  if (forwarder) {
    pendingEntries.push(entry);
  }
}

function flushPending() {
  if (!forwarder || pendingEntries.length === 0) return;
  forwarder(pendingEntries.slice());
  pendingEntries = [];
}

module.exports = {
  enable,
  disable,
  isEnabled,
  getEntries,
  clear,
  logRequest,
  logResponse,
  logNotify,
  setForwarder,
  flushPending,
  MAX_ENTRIES,
};
