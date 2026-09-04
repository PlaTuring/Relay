import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

function networkForbidden() {
  const error = new Error("RUNNER.NETWORK_FORBIDDEN");
  error.code = "RUNNER.NETWORK_FORBIDDEN";
  throw error;
}

function callbackNetworkForbidden(...args) {
  const callback = [...args].reverse().find((value) => typeof value === "function");
  const error = new Error("RUNNER.NETWORK_FORBIDDEN");
  error.code = "RUNNER.NETWORK_FORBIDDEN";
  if (callback) {
    queueMicrotask(() => callback(error));
    return {};
  }
  throw error;
}

net.connect = networkForbidden;
net.createConnection = networkForbidden;
net.Socket.prototype.connect = networkForbidden;
tls.connect = networkForbidden;
http.request = networkForbidden;
http.get = networkForbidden;
https.request = networkForbidden;
https.get = networkForbidden;
http2.connect = networkForbidden;
dgram.createSocket = networkForbidden;

for (const method of [
  "lookup",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse"
]) {
  if (typeof dns[method] === "function") dns[method] = callbackNetworkForbidden;
  if (typeof dnsPromises[method] === "function") dnsPromises[method] = networkForbidden;
}

globalThis.fetch = networkForbidden;
globalThis.WebSocket = class NetworkForbiddenWebSocket {
  constructor() {
    networkForbidden();
  }
};

syncBuiltinESMExports();
