import { type EngineResponse, type RedisQueueData } from "@repo/common/common";
import { engineStore } from "./engine-store";
import { redisManager } from "@repo/redis-client/redis-client";


export function createOrder(parsedResponse: RedisQueueData): EngineResponse {
  if (parsedResponse.type !== "create_order") return {
    correlationId: parsedResponse.clientId,
    ok: false,
    error: "invalid type"
  }

  const { side, symbol, type, userId, price, qty, orderId } = parsedResponse.data;

  if (type === "LIMIT") {
    // for limit we need both price and qty (conceptual)
    if (price === undefined || qty === undefined) {
      return {
        correlationId: parsedResponse.clientId,
        ok: false,
        error: "Price and quantity both should be defined.",
      };
    }

    // things like checking balances, locking amount and finding best price
    const beforeOrderResponseOne = engineStore.beforeOrder(parsedResponse);
    
    if (beforeOrderResponseOne.type === "ERROR" || beforeOrderResponseOne.type === "ORDER_IN_ORDERBOOK") {
      return beforeOrderResponseOne
    }
    
    const { keyPrice, qty: keyQty, orderBookKey } = beforeOrderResponseOne.data?.data! as {
      keyPrice: number,
      qty: number,
      orderBookKey: number
    }
        
    if (keyQty >= qty) {
      const users = engineStore.getUserInvolvedInSwap(orderBookKey, qty, side) ?? []

      console.log("users after swap", users)
      
      if (side === "BUY") {
        /**
         * here we are handling that the key's qty is greater than user's ask so we will give all of that
         * userProfit = price - keyPrice (keyPrice can be less also as we are finding best price)
         * 
         * so if price = 100
         * and keyPrice = 80
         * userProfit = 100 - 80 = 20
         * finalPrice = price - userProfit (user have to pay this much only)
         */
        const userProfit = price - keyPrice;
        const finalPrice = price - userProfit;

        // main fn for completing the shit
        const res = engineStore.completeOrder(
          side,
          orderBookKey,
          qty,
          qty,
          userId,
          finalPrice,
          type,
          users,
          orderId,
          "MANUAL"
        );
        
        return {
          correlationId: parsedResponse.clientId,
          ok: true,
          data: {
            message: "Order swapped successfully",
            data: res,
          },
        };
      }

      if (side === "SELL") {
        const userProfit = keyPrice - price;
        const finalPrice = price + userProfit;
        const res = engineStore.completeOrder(
          side,
          orderBookKey,
          qty,
          qty,
          userId,
          finalPrice,
          type,
          users,
          orderId,
          "MANUAL"
        );
        
        return {
          correlationId: parsedResponse.clientId,
          ok: true,
          data: {
            message: "Order swapped successfully",
            data: res
          },
        };
      }
    } else {
      const users = engineStore.getUserInvolvedInSwap(orderBookKey, keyQty, side) ?? []
      
      if (side === "BUY") {
        const leftQty = qty - keyQty
        const userProfit = price - keyPrice;
        const finalPrice = price - userProfit;
        
        const res = engineStore.completeOrder(
          side,
          orderBookKey,
          qty,
          keyQty, 
          userId,
          finalPrice,
          type,
          users,
          orderId,
          "MANUAL"
        );

        if (leftQty !== 0) {
          createOrder({
            ...parsedResponse,
            data: { ...parsedResponse.data, qty: leftQty }
          })
        }
        
        return {
          correlationId: parsedResponse.clientId,
          ok: true,
          data: {
            message: "Order swapped successfully",
            data: res
          },
        };
      }

      if (side === "SELL") {
        const leftQty = qty - keyQty;
        const userProfit = keyPrice - price;
        const finalPrice = price + userProfit;
        
        const res = engineStore.completeOrder(
          side,
          orderBookKey,
          qty,
          leftQty,
          userId,
          finalPrice,
          type,
          users,
          orderId,
          "MANUAL"
        );

        if (leftQty !== 0) {
          createOrder({
            ...parsedResponse,
            data: { ...parsedResponse.data, qty: leftQty }
          })
        }
                
        return {
          correlationId: parsedResponse.clientId,
          ok: true,
          data: {
            message: "Order swapped successfully",
            data: res
          },
        };
      }
    }
  }

  if (type === "MARKET") {
  
    if (price === undefined && qty === undefined) {
      return {
        correlationId: parsedResponse.clientId,
        ok: false,
        error: "Price and quantity both should be defined.",
      };
    }

    let calculatedPrice = 0;
    let calculatedQty = 0;
    
    if (price) {
      calculatedQty = price / engineStore.getLastTradingPrice()
      calculatedPrice = price
    } else if (qty) {
      calculatedPrice = qty * engineStore.getLastTradingPrice()
      calculatedQty = qty
    }

    const beforeOrderResponseOne = engineStore.beforeOrder({
      ...parsedResponse,
      data: { ...parsedResponse.data, price: calculatedPrice, qty: calculatedQty }
    });
    
    if (!beforeOrderResponseOne.ok) return beforeOrderResponseOne
    if (beforeOrderResponseOne.ok && !beforeOrderResponseOne.data?.data) return beforeOrderResponseOne
    
    const { keyPrice, qty: keyQty, orderBookKey } = beforeOrderResponseOne.data?.data! as {
      keyPrice: number,
      qty: number,
      orderBookKey: number
    }
    
    if (keyQty >= qty!) {
      const users = engineStore.getUserInvolvedInSwap(orderBookKey, calculatedQty, side) ?? []

      if (side === "BUY") {
        const userProfit = calculatedPrice - keyPrice;
        const finalPrice = calculatedPrice - userProfit;
        const res = engineStore.completeOrder(
          side,
          orderBookKey,
          calculatedQty,
          calculatedQty,
          userId,
          finalPrice,
          type,
          users,
          orderId,
          "MANUAL"
        );

        return {
          correlationId: parsedResponse.clientId,
          ok: true,
          data: {
            message: "Order swapped successfully",
            data: res
          },
        };
      }

      if (side === "SELL") {
        const userProfit = keyPrice - calculatedPrice;
        const finalPrice = calculatedPrice + userProfit;
        const res = engineStore.completeOrder(
          side,
          orderBookKey,
          calculatedQty,
          calculatedQty,
          userId,
          finalPrice,
          type,
          users,
          orderId,
          "MANUAL"
        );
        
        return {
          correlationId: parsedResponse.clientId,
          ok: true,
          data: {
            message: "Order swapped successfully",
            data: res
          },
        };
      }

    } else {
      return {
        correlationId: parsedResponse.clientId,
        ok: false,
        error: "No matching orders found"
      }
    }
  } 

  return {
    correlationId: parsedResponse.clientId,
    ok: false,
    error: "meowww"
  }
}


export function deleteOrder(parsedResponse: RedisQueueData): EngineResponse {
  if (parsedResponse.type !== "cancel_order") return {
    correlationId: parsedResponse.clientId,
    ok: false
  };

  const { orderId, userId } = parsedResponse.data;
  const res = engineStore.deleteOrder(userId, orderId);
  redisManager.pushDataInOrderQueue(parsedResponse, "orderbook-to-db-queue")
  return {
    correlationId: parsedResponse.clientId,
    ok: res ? true : false,
    data: res
      ? {
          message: "Order deleted successfully",
          data: undefined,
        }
      : undefined,
    error: !res ? "Order with the given Id not found" : undefined,
  };
}


export function getDepth(parsedResponse: RedisQueueData): EngineResponse {
  if (parsedResponse.type !== "get_depth") return {
    ok: false,
    correlationId: parsedResponse.clientId
  }
  
  const { symbol } = parsedResponse.data;
  const res = engineStore.getSymbolDepth(symbol);

  return {
    correlationId: parsedResponse.clientId,
    ok: res ? true : false,
    data: res
      ? {
          message: "depth found successfully",
          data: res,
        }
      : undefined,
    error: !res ? "Depth with the given symbol not found" : undefined,
  };
}


export function getFills(parsedResponse: RedisQueueData): EngineResponse {
  if (parsedResponse.type !== "get_fills") return {
    ok: false,
    correlationId: parsedResponse.clientId
  }

  const { userId } = parsedResponse.data;
  const res = engineStore.getFills(userId);

  return {
    correlationId: parsedResponse.clientId,
    ok: res ? true : false,
    data: res
      ? {
          message: "Fills found successfully",
          data: res,
        }
      : undefined,
    error: !res ? "Fills for the given userId not found" : undefined,
  };  
}


export function getOrder(parsedResponse: RedisQueueData): EngineResponse {
  if (parsedResponse.type !== "get_order") return {
    ok: false,
    correlationId: parsedResponse.clientId
  }

  const { orderId, userId } = parsedResponse.data;
  const res = engineStore.getOrder(orderId, userId);

  return {
    correlationId: parsedResponse.clientId,
    ok: res ? true : false,
    data: res
      ? {
          message: "Order found successfully",
          data: res,
        }
      : undefined,
    error: !res
      ? "Order with the given userId and orderId not found"
      : undefined,
  }
  
}

export function getOrders(parsedResponse: RedisQueueData): EngineResponse {
  if (parsedResponse.type !== "get_orders") return {
    ok: false,
    correlationId: parsedResponse.clientId
  }
  
  const { userId, open } = parsedResponse.data;
  const res = engineStore.getOrders(userId, open);

  return {
    correlationId: parsedResponse.clientId,
    ok: res.length ? true : false,
    data: res.length
      ? {
          message: "Orders found successfully",
          data: res,
        }
      : undefined,
    error: !res.length
      ? "Orders for the given userId not found"
      : undefined,
  }
 
}


export function getUserBalance(parsedResponse: RedisQueueData): EngineResponse {
  if (parsedResponse.type !== "get_user_balance") return {
    ok: false,
    correlationId: parsedResponse.clientId
  }

  
  const { userId } = parsedResponse.data;
  const res = engineStore.getUserBalance(userId);

  return {
    correlationId: parsedResponse.clientId,
    ok: res ? true : false,
    data: res
      ? {
          message: "User balance found successfully",
          data: res,
        }
      : undefined,
    error: !res
      ? "User balance with the given userId not found"
      : undefined,
  }

}


export function getBalanceFromStockExchange() {
  const prices = [10, 20, 30, 40];
  
  const price = prices[Math.floor(Math.random() * prices.length)]!;

  console.log("price from excahange", price);
  
  return price;
}


export function checkLiquidation() {
  try {

    const CURRENT_PRICE = getBalanceFromStockExchange();

    updatePnl(CURRENT_PRICE)
    
    // comparing the liquidation price of all the users ( less than or equal to 80 )
    const POSITIONS_MAPS = engineStore.getAllPositionsMaps();

    // in the case of LONG if the current_price is less or equal to the liquidatePrice then liquidate 
    for (const [idx, [key, val]] of (Object.entries(Object.entries(POSITIONS_MAPS["LONG"])))) {
      const POSITION_LIQUIDATE_PRICE = Number(key);
      const IDX = Number(idx);
      
      console.log("val", val)
      
      if (CURRENT_PRICE <= POSITION_LIQUIDATE_PRICE) liquidate(val[IDX]!);
    }


    
    // in the case of LONG if the current_price is more or equal to the liquidatePrice then liquidate 
    for (const [idx, [key, val]] of (Object.entries(Object.entries(POSITIONS_MAPS["SHORT"])))) {
      const POSITION_LIQUIDATE_PRICE = Number(key);
      const IDX = Number(idx);

      if (CURRENT_PRICE >= POSITION_LIQUIDATE_PRICE) liquidate(val[IDX]!);
    }
  } catch (e) {
    console.log("error in liquidation worker", e);
  }
}


export function liquidate(userId: string) {
  console.log("running", userId)

  const position = engineStore.getPosition(userId);
  if (!position) return;

  console.log("position", position);
  
  const clientId = crypto.randomUUID();    
  const orderId = crypto.randomUUID();
  
  // after pnl getting updated
  let latestPrice = position.averagePrice; // 100
  
  if (position.isProfit) {
    latestPrice += position.pnl
  } else {
    latestPrice -= position.pnl // pnl: 80 -- latestPrice: 20
  }
  
  const res = createOrder({
    clientId,
    data: {
      market: "SPOT",
      orderId,
      side: position.type === "LONG" ? "SELL" : "BUY",
      symbol: "INR/AXIS",
      type: "MARKET",
      userId: position.userId,
      price: latestPrice,
      qty:  position.qty,
      way: "EXCHANGE",
    },
    type: "create_order"
  })

  if (!res.ok) {
    // liquidate here using (ADL)

    // liquidate from the positions onlyy
    const liquidablePositon = 
      engineStore.getLiquidablePosition(latestPrice, position.qty, position.type);
  
    if (!liquidablePositon) return;
  
    console.log("liquidablePosition", liquidablePositon);
    
    // calculate the loss of the current user
    const lossOfCurrentUser = position.averagePrice - latestPrice;

    // calculate the profit of the liquudable positon user
    const profileOfLiquidableUser = lossOfCurrentUser;
    
    // cal left qty of liquidable user (if left then create the other side position else nothing)
    const leftQtyofLiquidableUser = position.qty - liquidablePositon.qty;
    
    if (leftQtyofLiquidableUser > 0) {
      // create other side position
    }

    // add these loss/profit to respective accounts

    // for present user
    engineStore.deductTotalBalalnceOfUser(
      position.userId, 
      position.type === "LONG" ? "BUY" : "SELL", 
      lossOfCurrentUser, 
      position.qty, 
      true
    )
    engineStore.resetLockBalalnceOfUser(
      position.userId, 
      position.type === "LONG" ? "BUY" : "SELL",
      true
    )

    // for the liquidable user
    engineStore.deductTotalBalalnceOfUser(
      liquidablePositon.userId, 
      liquidablePositon.type === "LONG" ? "BUY" : "SELL", 
      profileOfLiquidableUser, 
      liquidablePositon.qty, 
      false
    )
    engineStore.resetLockBalalnceOfUser(
      liquidablePositon.userId, 
      liquidablePositon.type === "LONG" ? "BUY" : "SELL",
      false
    )
    
    // close both the postions
    engineStore.deletePosition(position.userId)
    engineStore.deletePosition(liquidablePositon.userId)
  }
}


export function updatePnl(CURRENT_PRICE: number) {
  // getting the price from the binance / mock server (for eg 80)

  const positions = engineStore.getAllPositions();

  for (const val of positions) {
    let pnl = 0 
    let isProfit = false;
    
    if (val.type === "LONG") {
      if (val.averagePrice >= CURRENT_PRICE) {
        // avg: 100 - curr: 20 (loss)
        pnl = val.averagePrice - CURRENT_PRICE
        isProfit = false
      } else {
        // curr: 120 - avg: 100 (profit)
        pnl = CURRENT_PRICE - val.averagePrice
        isProfit = true
      }
    }
    
    if (val.type === "SHORT") {
      if (val.averagePrice >= CURRENT_PRICE) {
        // avg: 100 - curr: 80 (loss)
        pnl = val.averagePrice - CURRENT_PRICE
        isProfit = true
      } else {
        // curr: 120 - avg: 120 (profit)
        pnl = CURRENT_PRICE - val.averagePrice
        isProfit = false
      }
    }
    
    engineStore.deletePosition(val.userId);
    engineStore.createPosition({
      ...val,
      pnl,
      isProfit,
    });
  } 
}