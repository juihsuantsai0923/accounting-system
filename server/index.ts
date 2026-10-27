import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index";
import { createContext } from "./context";
import { ensureAdmin } from "./ensureAdmin";
import { ensureSalaryExpenseTypes } from "./ensureSalaryExpenseTypes";
import { db } from "./db";
import { handleSyncRequest } from "./webOrdersSync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 資料庫資料表已在 import "./db" 時自動建立，這裡只需確保至少有一組管理員帳號，
  // 並補齊每位老師／銷售員對應的「薪水」支出類型（既有帳號也會在這裡一次補上）。
  await ensureAdmin(db, { ADMIN_EMAIL: process.env.ADMIN_EMAIL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD });
  await ensureSalaryExpenseTypes(db);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.post("/api/web-orders/sync", async (req, res) => {
    const [status, payload] = await handleSyncRequest(db, req.header("x-sync-key") ?? null, req.body);
    res.status(status).json(payload);
  });

  app.use("/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  if (process.env.NODE_ENV === "production") {
    const clientDist = path.resolve(__dirname, "../dist/client");
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;
  app.listen(PORT, () => {
    console.log(`✅ tRPC server running on http://localhost:${PORT}/trpc`);
  });
}

main().catch((err) => {
  console.error("❌ 伺服器啟動失敗:", err);
  process.exit(1);
});
