import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { prisma } from "../prisma.js";

type AuthedSocket = WebSocket & { userId?: string; role?: string; vendorId?: string };

const vendorSockets = new Map<string, Set<AuthedSocket>>();   // vendorId -> sockets
const userSockets = new Map<string, Set<AuthedSocket>>();     // userId -> sockets (consumers + vendors)

function addToMap(map: Map<string, Set<AuthedSocket>>, key: string, ws: AuthedSocket) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(ws);

  ws.on("close", () => {
    set!.delete(ws);
    if (set!.size === 0) map.delete(key);
  });
}

export function notifyVendor(vendorId: string, event: string, payload: any) {
  const set = vendorSockets.get(vendorId);
  if (!set) return;

  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function notifyUser(userId: string, event: string, payload: any) {
  const set = userSockets.get(userId);
  if (!set) return;

  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function initWebSockets(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws: AuthedSocket, req) => {
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token");
      if (!token) {
        ws.close(4401, "Missing token");
        return;
      }

      const decoded = jwt.verify(token, env.JWT_SECRET) as any;
      const userId = decoded?.sub ?? decoded?.id ?? decoded?.userId;
      const role = decoded?.role;

      if (!userId) {
        ws.close(4401, "Invalid token");
        return;
      }

      ws.userId = userId;
      ws.role = role;

      // all authed users get registered for direct user notifications
      addToMap(userSockets, userId, ws);

      // vendors also register vendorId channel
      if (role === "VENDOR") {
        const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
        if (!vendor) {
          ws.close(4404, "Vendor not found");
          return;
        }
        ws.vendorId = vendor.id;
        addToMap(vendorSockets, vendor.id, ws);
      }

      ws.send(JSON.stringify({ event: "ready", payload: { ok: true, role } }));

      ws.on("message", (buf) => {
        const msg = buf.toString();
        if (msg === "ping") ws.send(JSON.stringify({ event: "pong", payload: Date.now() }));
      });
    } catch {
      ws.close(4401, "Unauthorized");
    }
  });

  return wss;
}  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws: AuthedSocket, req) => {
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token");

      if (!token) {
        ws.close(4401, "Missing token");
        return;
      }

      const decoded = jwt.verify(token, env.JWT_SECRET) as any;

      // Support common token shapes
      const userId = decoded?.sub ?? decoded?.id ?? decoded?.userId;
      const role = decoded?.role;

      if (!userId) {
        ws.close(4401, "Invalid token");
        return;
      }

      ws.userId = userId;
      ws.role = role;

      // Vendor sockets are what we need for dispatch
      if (role === "VENDOR") {
        const vendor = await prisma.vendorProfile.findUnique({ where: { userId } });
        if (!vendor) {
          ws.close(4404, "Vendor not found");
          return;
        }
        ws.vendorId = vendor.id;
        addVendorSocket(vendor.id, ws);
      }

      ws.send(JSON.stringify({ event: "ready", payload: { ok: true, role } }));

      ws.on("message", (buf) => {
        const msg = buf.toString();
        if (msg === "ping") ws.send(JSON.stringify({ event: "pong", payload: Date.now() }));
      });
    } catch {
      ws.close(4401, "Unauthorized");
    }
  });

  return wss;
}
