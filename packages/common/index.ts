import z, { type ZodError } from "zod";

export type MessageType = {
	name: string;
	messages: { id: string, message: any }[]
}

export const HTTP_BACKEND_STREAM_CONFIGS = {
	stream: `http-backend-stream-${crypto.randomUUID()}`,
	group_name: "http-backend-group",
	consumer_grp: `http-backend-consumer-group-${crypto.randomUUID()}`
}

export const ORDER_ENGINE_STREAM_CONFIGS = {
	stream: `order-engine-stream`,
	group_name: "order-engine-group",
	consumer_grp: `order-engine-consumer-group-${crypto.randomUUID()}`
}

export const COMMON_STREAM_CONFIGS = {
	stream: `common-stream`,
	group_name: "common-group",
	consumer_grp: `common-consumer-group-${crypto.randomUUID()}`
}

export const GROUPS = [HTTP_BACKEND_STREAM_CONFIGS, ORDER_ENGINE_STREAM_CONFIGS, COMMON_STREAM_CONFIGS]

export const zodErrorMessage = ({ error }: { error: ZodError }) => {
  return error.issues.map((er) => `${er.path.join(".")}: ${er.message}`);
};

export const createOrderSchema = z.object({
  userId: z.uuid(),
  orderId: z.uuid(),
  correlationId: z.uuid(),
  symbol: z.string().includes("/"),
  price: z.number().optional(),
  qty: z.number().optional(),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["LIMIT", "MARKET"]),
  way: z.enum(["MANUAL", "EXCHANGE"]),
});
