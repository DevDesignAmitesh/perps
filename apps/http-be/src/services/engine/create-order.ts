import type { Request, Response } from "express";
import { redisManager } from "@repo/redis-client/redis-client";
import { 
  createOrderSchema, 
  zodErrorMessage,
  HTTP_BACKEND_STREAM_CONFIGS,
  ORDER_ENGINE_STREAM_CONFIGS,
} from "@repo/common/common";

export async function createOrder(req: Request, res: Response) {
  const orderId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();

  const { data, success, error } = createOrderSchema.safeParse({
    ...req.body,
    market: req.params.market,
    orderId,
    correlationId,
    way: "MANUAL",
  });

  if (!success) {
    res
      .status(411)
      .json({ message: "invalid inputs", error: zodErrorMessage({ error }) });

    return;
  }
    
  const response = await redisManager.waitForData(
    // putting data in this thing
    HTTP_BACKEND_STREAM_CONFIGS.group_name,
    HTTP_BACKEND_STREAM_CONFIGS.consumer_grp,
    HTTP_BACKEND_STREAM_CONFIGS.stream,

    // waiting for the response from this thing
    ORDER_ENGINE_STREAM_CONFIGS.stream,
    data,
  );

  const finalData = JSON.parse(response.messages[0]?.message.data);

  console.log("response from the engine", finalData);

  if (finalData.correlationId === correlationId) {
    return res.json({ data: finalData }); 
  }
  
  
}