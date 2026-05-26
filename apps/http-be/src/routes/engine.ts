import { Router } from "express";
import { onramp } from "../services/engine/onramp";
import { createOrder } from "../services/engine/create-order";
import { deleteOrder } from "../services/engine/delete-order";
import { availableEquity } from "../services/engine/available-equity";
import { marketOpenPosition } from "../services/engine/market-open-pos";
import { marketClosePosition } from "../services/engine/market-close.pos";
import { marketOpenOrders } from "../services/engine/market-open.ord";
import { marketOrders } from "../services/engine/market-ord";
import { fills } from "../services/engine/get-fills";

export const engineRouter = Router();

engineRouter.post("/onramp", onramp)
engineRouter.post("/order", createOrder)
engineRouter.delete("/order", deleteOrder)
engineRouter.get("/equity/available", availableEquity)
engineRouter.get("/positions/open/:marketId", marketOpenPosition);
engineRouter.get("/positions/closed/:marketId", marketClosePosition);
engineRouter.get("/orders/open/:marketId", marketOpenOrders)
engineRouter.get("/orders/:marketId", marketOrders)
engineRouter.get("/fills", fills);