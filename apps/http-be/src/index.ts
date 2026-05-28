import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth";
import { engineRouter } from "./routes/engine";
export const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({ ok: true });
});

app.get("/api/v1/", (_req, res) => {
    res.json({ status: "ok" });
})
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/engine", engineRouter);
