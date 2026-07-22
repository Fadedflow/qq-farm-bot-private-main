const http = require('node:http');
const tls = require('node:tls');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CA_CERT_PATH = path.join(DATA_DIR, 'qq-proxy-ca.pem');
const CA_KEY_PATH = path.join(DATA_DIR, 'qq-proxy-ca-key.pem');
const TMP_DIR = path.join(DATA_DIR, 'proxy-tmp');

const GATE_HOST = 'gate-obt.nqf.qq.com';
const GATE_PATH_PREFIX = '/prod/ws';

let proxyServer = null;
let proxyPort = 0;
let capturedCodes = [];
let isRunning = false;
let caCertPem = null;
let caKeyPem = null;
let onCodeCaptured = null;

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function runOpenSSL(args) {
  return execSync(`openssl ${args}`, { encoding: 'utf8', timeout: 5000 });
}

function loadOrGenerateCA() {
  if (fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH)) {
    caCertPem = fs.readFileSync(CA_CERT_PATH, 'utf8');
    caKeyPem = fs.readFileSync(CA_KEY_PATH, 'utf8');
    return;
  }

  ensureDir(DATA_DIR);

  runOpenSSL(
    `req -x509 -newkey rsa:2048 -nodes -keyout "${CA_KEY_PATH}" -out "${CA_CERT_PATH}"`
    + ` -days 3650 -subj "/CN=QQ Farm Proxy CA/O=QQFarmBot/C=CN"`
    + ` -addext "basicConstraints=critical,CA:TRUE,pathlen:0"`
    + ` -addext "keyUsage=critical,keyCertSign,cRLSign"`
  );

  caCertPem = fs.readFileSync(CA_CERT_PATH, 'utf8');
  caKeyPem = fs.readFileSync(CA_KEY_PATH, 'utf8');
}

function getCertForHostname(hostname) {
  if (certCache[hostname]) return certCache[hostname];

  const safeName = hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const hostKeyPath = path.join(TMP_DIR, `${safeName}.key`);
  const hostCsrPath = path.join(TMP_DIR, `${safeName}.csr`);
  const hostCertPath = path.join(TMP_DIR, `${safeName}.pem`);
  const extPath = path.join(TMP_DIR, `${safeName}.ext`);

  ensureDir(TMP_DIR);

  runOpenSSL(`genrsa -out "${hostKeyPath}" 2048`);
  runOpenSSL(
    `req -new -key "${hostKeyPath}" -out "${hostCsrPath}"`
    + ` -subj "/CN=${hostname}"`
  );

  fs.writeFileSync(
    extPath,
    `subjectAltName=DNS:${hostname}\nbasicConstraints=CA:FALSE\n`
  );

  runOpenSSL(
    `x509 -req -in "${hostCsrPath}" -CA "${CA_CERT_PATH}" -CAkey "${CA_KEY_PATH}"`
    + ` -CAcreateserial -out "${hostCertPath}" -days 365`
    + ` -extfile "${extPath}"`
  );

  const cert = fs.readFileSync(hostCertPath, 'utf8');
  const key = fs.readFileSync(hostKeyPath, 'utf8');

  certCache[hostname] = { cert, key };
  return certCache[hostname];
}

function getLANIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const addr = iface.address;
        if (!addr.startsWith('169.254.')) {
          return addr;
        }
      }
    }
  }
  return '0.0.0.0';
}

function parseHttpRequest(buf) {
  const str = buf.toString('utf8');
  const lines = str.split('\r\n');
  if (lines.length === 0) return null;

  const firstLine = lines[0];
  const methodMatch = firstLine.match(/^(\w+)\s+(\S+)\s+HTTP/);
  if (!methodMatch) return null;

  const method = methodMatch[1];
  const path = methodMatch[2];
  const headers = {};

  for (let i = 1; i < lines.length; i++) {
    const colonIdx = lines[i].indexOf(':');
    if (colonIdx > 0) {
      const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
      const value = lines[i].substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  return { method, path, headers, raw: str };
}

function extractCodeFromData(buf) {
  const str = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  const codeMatch = str.match(/[?&]code=([^&\s]+)/);
  return codeMatch ? decodeURIComponent(codeMatch[1]) : null;
}

function handleConnection(clientSocket) {
  let buf = Buffer.alloc(0);

  clientSocket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const parsed = parseHttpRequest(buf);
    if (!parsed) return;
    clientSocket.removeAllListeners('data');

    if (parsed.method === 'CONNECT') {
      handleConnect(clientSocket, parsed, buf);
    } else {
      handleHttpRequest(clientSocket, parsed, buf);
    }
  });

  clientSocket.on('error', () => {});
}

function handleConnect(clientSocket, parsed, initialBuf) {
  const [hostname, portStr] = parsed.path.split(':');
  const port = parseInt(portStr, 10) || 443;
  const isTargetHost = hostname === GATE_HOST || hostname.endsWith('.' + GATE_HOST);

  if (isTargetHost) {
    try {
      const tlsCtx = getCertForHostname(hostname);
      const serverSide = tls.connect({
        host: hostname,
        port,
        rejectUnauthorized: false,
      });

      serverSide.on('error', () => {
        try { clientSocket.end(); } catch {}
      });

      serverSide.once('secureConnect', () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

        const onData = (data) => {
          const code = extractCodeFromData(data);
          if (code && !capturedCodes.includes(code)) {
            capturedCodes.push(code);
            if (onCodeCaptured) onCodeCaptured(code);
          }
        };

        serverSide.on('data', onData);

        serverSide.once('data', () => {
          serverSide.removeListener('data', onData);
          clientSocket.pipe(serverSide);
          serverSide.pipe(clientSocket);
        });

        clientSocket.pipe(serverSide);
      });
    } catch (err) {
      clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    }
  } else {
    const remote = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      clientSocket.pipe(remote);
      remote.pipe(clientSocket);
    });

    remote.on('error', () => {
      try { clientSocket.end(); } catch {}
    });
    clientSocket.on('error', () => {
      try { remote.end(); } catch {}
    });
  }
}

function handleHttpRequest(clientSocket, parsed, buf) {
  const bodyStart = buf.indexOf('\r\n\r\n');
  const body = bodyStart >= 0 ? buf.slice(bodyStart + 4) : Buffer.alloc(0);

  let host, port, reqPath;
  if (parsed.path.startsWith('http://') || parsed.path.startsWith('https://')) {
    const url = new URL(parsed.path);
    host = url.hostname;
    port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
    reqPath = url.pathname + url.search;
  } else {
    const hostHeader = parsed.headers.host || 'localhost';
    const hp = hostHeader.split(':');
    host = hp[0];
    port = parseInt(hp[1], 10) || 80;
    reqPath = parsed.path;
  }

  const options = {
    hostname: host,
    port,
    path: reqPath,
    method: parsed.method,
    headers: { ...parsed.headers, host: host },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let head = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}\r\n`;
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (k !== 'transfer-encoding' && k !== 'connection') {
        head += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
      }
    }
    head += '\r\n';
    clientSocket.write(head);
    proxyRes.pipe(clientSocket);
  });

  proxyReq.on('error', () => {
    try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {}
  });

  if (body.length > 0) {
    proxyReq.write(body);
    proxyReq.end();
  } else {
    proxyReq.end();
  }

  clientSocket.on('data', (chunk) => {
    proxyReq.write(chunk);
  });
  clientSocket.on('end', () => {
    proxyReq.end();
  });
}

function startProxy(callback) {
  if (isRunning) {
    if (callback) callback(null, proxyPort);
    return;
  }

  loadOrGenerateCA();
  capturedCodes = [];

  proxyServer = net.createServer(handleConnection);
  proxyServer.on('error', (err) => {
    if (callback) callback(err);
  });

  proxyServer.listen(0, '0.0.0.0', () => {
    proxyPort = proxyServer.address().port;
    isRunning = true;
    if (callback) callback(null, proxyPort);
  });
}

function stopProxy() {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
  }
  isRunning = false;
  proxyPort = 0;
}

function getStatus() {
  return {
    running: isRunning,
    port: proxyPort,
    address: getLANIP(),
    codeCount: capturedCodes.length,
  };
}

function getCapturedCodes() {
  return capturedCodes.slice();
}

function clearCodes() {
  capturedCodes = [];
}

function getCACert() {
  if (!caCertPem) loadOrGenerateCA();
  return caCertPem;
}

module.exports = {
  startProxy,
  stopProxy,
  getStatus,
  getCapturedCodes,
  clearCodes,
  getCACert,
  setCodeCallback: (fn) => { onCodeCaptured = fn; },
};
