import z, { type ZodError } from "zod";
import { sign, verify, type JwtPayload } from "jsonwebtoken";

export type MessageType = {
	name: string;
	messages: { id: string, message: any }[]
}

export type EngineResponse =  {
  correlationId: string;
  ok: boolean;
  data?: {
    message: string,
    data: unknown
  }
  error?: string;
}

type CreateOrder = z.infer<typeof createOrderSchema>;

export type RedisQueueData =
  | {
      type: "create_order";
      data: CreateOrder;
      clientId: string;
    }
  | {
      type: "cancel_order";
      data: { orderId: string; userId: string };
      clientId: string;
    }
  | {
      type: "get_order";
      data: { orderId: string; userId: string };
      clientId: string;
    }
  | {
      type: "get_depth";
      data: { symbol: string };
      clientId: string;
    }
  | {
      type: "get_orders";
      data: { userId: string; open?: boolean };
      clientId: string;
    }
  | {
      type: "get_fills";
      data: { userId: string };
      clientId: string;
    }
  | {
      type: "get_user_balance";
      data: { userId: string };
      clientId: string;
    };

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

export const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(3, "password should be atleast 4 words"),
});

export const signinSchema = z.object({
  email: z.email(),
  password: z.string().min(3, "password should be atleast 4 words"),
});

export const deleteSingleOrderSchema = z.object({
  orderId: z.uuid(),
});

export const getSymbolDepthSchema = z.object({
  symbol: z.string().includes("-"),
});

export const getSingleOrderSchema = z.object({
  orderId: z.uuid(),
  userId: z.uuid(),
});

export const getOrdersSchema = z.object({
  open: z.boolean().default(false),
  userId: z.uuid(),
});

export const generateToken = (userId: string, secret: string) => {
  return sign({ userId }, secret);
};

export const verifyToken = (token: string, secret: string) => {
  try {
    return verify(token, secret) as JwtPayload;
  } catch (e) {
    console.log("verify token error ", e);
    return null;
  }
};

export type RedisDbQueueData =
  | {
      type: "create_order_fills_position";
      data: {
        order: Order,
        fills: Fill[],
        positions: Position[],
      }
    }
  | {
      type: "cancel_order";
      data: { orderId: string; userId: string };
    };

export type RedisWsQueueData =
  // | {
  //     type: "order_book";
  //     data: OrderBook
  //   }
  | {
      type: "order_book";
      data: UserBasedOrderBook
    }


export type EngineCommandType =
  | "create_order"
  | "get_depth"
  | "get_user_balance"
  | "get_order"
  | "get_orders"
  | "get_fills"
  | "cancel_order";

export type BeforeOrderResponse = EngineResponse & {
  type: "ORDER_IN_ORDERBOOK" | "ERROR" | "AVAILABLE_PRICE"
}

export type BalanceKey = "INR" | "AXIS";

export type Balance = Record<
  string,
  Record<
    BalanceKey,
    {
      total: number;
      locked: number;
    }
  >
>;

export type Order = {
  id: string;
  userId: string;
  market: OrderBookKey;
  price: number;
  qty: number;
  type: orderType;
  side: orderSide
  filledQty: number;
  status: orderStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type OrderBook = Record<
  OrderBookKey,
  {
    bids: Record<
      number,
      {
        totalQuantity: number;
      }
    >;
    asks: Record<
      number,
      {
        totalQuantity: number;
      }
    >;
    lastTradedPrice: number;
  }
>;

export type orderStatus = "FILLED" | "CANCELLED" | "PARTIAL_FILLED" | "OPEN";
export type orderSide = "BUY" | "SELL";
export type orderType = "LIMIT" | "MARKET";
export type OrderBookKey = "AXIS" | "TATA";


export type UserInOrderBook = { id: string, qty: number, price: number, createdAt: number }

export type OrderBookOrder = { 
  totalQuantity: number, 
  createdAt: number, 
  users: UserInOrderBook[] 
}

export type UserBasedOrderBook = Record<
  OrderBookKey,
  {
    bids: Record<
      number,
      OrderBookOrder
    >;
    asks: Record<
      number,
      OrderBookOrder
    >;
    lastTradedPrice: number;
  }
>;

export type postionType = "LONG" | "SHORT"

export type Position = {
  market: OrderBookKey;
  type: postionType;
  qty: number;
  margin: number;
  pnl: number;
  liquidationPrice: number;
  averagePrice: number;
  userId: string
  orderId: string
  isProfit: boolean
}

// LONG: {
  //  liquidationPice: userIds (string[])
// }
export type POSITIONS_MAPS = Record<postionType, Record<number, string[]>>

export type fillType = "MAKER" | "TAKER";

export type Fill = {
  id: string;
  makerOrderId: string;
  takerOrderId: string;
  makerId: string;
  takerId: string;
  filledQty: number,
  askedQty: number;
  price: number;
  asset: OrderBookKey;
  type: fillType;
  side: orderSide;
  createdAt: Date;
};

export const LIQUIDATION_PERCENTAGE = 0.2 // 20%
