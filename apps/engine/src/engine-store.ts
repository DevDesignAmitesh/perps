import { 
  LIQUIDATION_PERCENTAGE, 
  type Balance, 
  type BeforeOrderResponse, 
  type Fill, 
  type Order, 
  type OrderBookKey, 
  type orderSide, 
  type orderType, 
  type Position, 
  type POSITIONS_MAPS, 
  type postionType, 
  type RedisQueueData, 
  type UserBasedOrderBook, 
  type UserInOrderBook 
} from "@repo/common/common";
import { redisManager } from "@repo/redis-client/redis-client";
import fs from "fs";

class EngineStore {
  private static instance: EngineStore;
  private FILLS: Fill[];
  private ORDERS: Order[];
  private BALANCES: Balance;
  private USERORDERBOOK: UserBasedOrderBook
  private POSITIONS: Position[]
  private POSITIONS_MAPS: POSITIONS_MAPS

  constructor() {
    this.ORDERS = [];
    this.FILLS = [];
    this.POSITIONS = [];
    this.POSITIONS_MAPS = {
      LONG: {},
      SHORT: {}
    };
    this.BALANCES = this.readBackupData().BALANCES ?? {};
    this.USERORDERBOOK = this.readBackupData().USERORDERBOOK ?? {
      AXIS: { bids: {}, asks: {}, lastTradedPrice: 0 },
      TATA: { bids: {}, asks: {}, lastTradedPrice: 0 },
    };

    // setInterval(() => this.getSymbolDepth("INR-AXIS", true), 5 * 1000)
    // setInterval(() => this.backupData(), 5 * 1000)
    setInterval(() => {
      console.log("ORDERBOOK", this.USERORDERBOOK)
      console.log("BALANCES", this.BALANCES)
      console.log("POSITIONS", this.POSITIONS)
    }, 10 * 1000)
  }

  static getInstance = (): EngineStore => {
    if (!EngineStore.instance) EngineStore.instance = new EngineStore();
    return EngineStore.instance;
  };

  createPosition = (position: Position) => {
    this.POSITIONS.push(position);

    // create postion map using price and users
    // TODO: it will be liquidationPrice or price (that the user traded on)
    if (!this.POSITIONS_MAPS[position.type][position.liquidationPrice]) {
      this.POSITIONS_MAPS[position.type][position.liquidationPrice] = []
    }

    this.POSITIONS_MAPS[position.type][position.liquidationPrice]!.push(position.userId)
  }

  getAllPositions = (orderId?: string) => {
    if (orderId) {
      return this.POSITIONS.filter((pos) => pos.orderId === orderId);
    }
    return this.POSITIONS;
  }

  getLiquidablePosition = (price: number, qty: number, type: postionType) => {
    if (type === "LONG") {
      return this.getAllPositions()
        .filter((pos) => pos.type !== "LONG")
        .find((pos) => pos.averagePrice >= price && pos.qty >= qty)
      } else {
      return this.getAllPositions()
        .filter((pos) => pos.type !== "SHORT")
        .find((pos) => pos.averagePrice <= price && pos.qty >= qty)
    }
  }

  getPosition = (userId: string) => {
    return this.getAllPositions().find((ps) => ps.userId === userId)
  }

  getAllPositionsMaps = () => {
    return this.POSITIONS_MAPS;
  }

  calculateAveragePrice = (userId: string, type: orderType) => {
    const orders = this.getOrders(userId);
    
    let totalPrice = 0;
    let totalQty = 0;

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      if (!order) continue;
      if (order.type !== type) continue;

      totalPrice += order.price * order.qty;
      totalQty += order.qty;
    }

    return totalPrice / totalQty
  }

  calculateFinalPriceWithLeverage = (userId: string, price: number, qty: number) => {
    const balance = this.getUserBalance(userId);
    
    // 1 = 1x || 2 = 2x and so on
    let leverage = 0;
    let lockedPrice = 0;
    
    const priceAskedByUser = price * qty;
    
    const userActualBalance = balance.INR.total - balance.INR.locked; 

    if (userActualBalance >= priceAskedByUser) {
      lockedPrice = priceAskedByUser;
      leverage = 1
    } else {
      lockedPrice = userActualBalance
      leverage =  priceAskedByUser / userActualBalance;
    }

    return { leverage, priceAskedByUser, userActualBalance, lockedPrice }
  }
  
  deleteOrder = (userId: string, orderId: string) => {
    const orderIndex = this.ORDERS.findIndex((ord) => ord.userId === userId && ord.id === orderId);
    if (orderIndex === -1) return false;

    this.ORDERS.splice(orderIndex, 0)

    // send to queue also
    redisManager.pushDataInOrderQueue({
      type: "cancel_order",
      data: { orderId, userId }
    }, "orderbook-to-db-queue")
    
    return true;
  }

  createOrder = (order: Order) => {
    this.ORDERS.push(order)
  }

  pushOrderAndFillToQueue = (order: Order, fills: Fill[], positions: Position[]) => {
    redisManager.pushDataInOrderQueue({
      type: "create_order_fills_position",
      data: { order, fills, positions }
    }, "orderbook-to-db-queue")
  }



  getSymbolDepth = (symbol: string, isQueue?: boolean) => {
    // symbol === CURRENCY/STOCK (INR/AXIS);
    const stock = symbol.split("-")[1] as OrderBookKey | undefined;
    if(!stock) return null
      
    if (isQueue) {  
        redisManager.pushDataInWsQueue({
        type: "order_book",
        // data: this.ORDERBOOK
        data: this.USERORDERBOOK
      }, "orderbook-to-ws-queue")
    }
    
    // return this.ORDERBOOK[stock]
    return this.USERORDERBOOK[stock]
  }

  getFills = (userId: string, orderId?: string) => {
    const arr: Fill[] = []    

    console.log("FILLS", this.FILLS);
    
    if (orderId) {
      this.FILLS.forEach((fls) => {
        if (fls.takerId === userId || fls.makerId == userId) {
          if (fls.makerOrderId === orderId || fls.takerOrderId === orderId) {
            arr.push(fls)
          }
        }
      });
    } else {
      this.FILLS.forEach((fls) => {
        if (fls.takerId === userId || fls.makerId == userId) {
          arr.push(fls)
        }
      });
    }
    
    return arr;
  }

  getOrder = (orderId: string, userId: string) => {
    return this.ORDERS.find((ord) => ord.userId === userId && ord.id === orderId && ord.status !== "CANCELLED");
  }

  getOrders = (userId: string, open?: boolean) => {
    const arr = [];

    if (open && open === true) {
      for (let ord of this.ORDERS) {
        if (ord.status === "CANCELLED") continue;
        if (ord.userId !== userId) continue;
        if (ord.status !== "OPEN") continue;
        
        arr.push(ord); 
      }
    } else {
      for (let ord of this.ORDERS) {
        if (ord.status === "CANCELLED") continue;
        if (ord.userId !== userId) continue;
        arr.push(ord);
      }
    }

    return arr;
  }


  getUserBalance = (userId: string) => {
    // if not then assign default values to the user and return it
    
    if (!this.BALANCES[userId]) {
      this.BALANCES[userId] = {
        AXIS: { locked: 0, total: 1000 },
        INR: { locked: 0, total: 10000 },
      };
    }

    return this.BALANCES[userId];
  }

  gettingAndLockingUserBalance = (userId: string, price: number, qty: number, side: orderSide) => {
    // getting user's balance
    const userBalance = this.getUserBalance(userId);
    if (!userBalance) return false;
    
    if (side === "BUY") {
      // while buying qty of a stock we need to confirm does the user have this much amout to PAY
      const requiredBalance = price * qty;
      /**
       * requiredBalance = 1000;
       * userBalance = userBalance.INR.total (1200) - userBalance.INR.locked (100)
       * userBalance = 1100
       * means allowed else not
      */
      
      if (requiredBalance > userBalance.INR.total - userBalance.INR.locked) return false;
      userBalance.INR.locked += requiredBalance;
      return true;
    } else if (side === "SELL") {
      // in the case of selling, does the user have this much qty to sell
      const requiredQty = qty;

      /**
       *requiredQty = 1000;
       * userBalance = userBalance.AXIS.total (1200) - userBalance.AXIS.locked (100)
       * userBalance = 1100
       * means allowed else not
      */
      
      if (requiredQty > userBalance.AXIS.total - userBalance.AXIS.locked) return false;
      userBalance.AXIS.locked += requiredQty;
      return true;
    }

    return false;
  }

  resetLockBalalnceOfUser = (userId: string, side: orderSide, presentUser: boolean) => {
    const userBalance = this.getUserBalance(userId);
    if (!userBalance) return false;

    if (presentUser) {
      if (side === "BUY") {
        userBalance.INR.locked = 0;
      } else {
        userBalance.AXIS.locked = 0;
      }
    } else {
      if (side === "SELL") {
        userBalance.INR.locked = 0;
      } else {
        userBalance.AXIS.locked = 0;
      }
    }
  }

  deductTotalBalalnceOfUser = (userId: string, side: orderSide, finalPrice: number, qty: number, presentUser: boolean) => {
    const userBalance = this.getUserBalance(userId);
    if (!userBalance) return false;

    if (presentUser) {
      if (side === "BUY") {
        userBalance.INR.total -= finalPrice * qty;
        userBalance.AXIS.total += qty;
      } else if (side === "SELL") {
        userBalance.INR.total += finalPrice * qty;
        userBalance.AXIS.total -= qty;
      }
    } else {
      if (side === "SELL") {
        userBalance.INR.total -= finalPrice * qty;
        userBalance.AXIS.total += qty;
      } else if (side === "BUY") {
        userBalance.INR.total += finalPrice * qty;
        userBalance.AXIS.total -= qty;
      }
    }
  }


  addNewAsksOrBidsInOrderBook = (
    type: "asks" | "bids",
    price: number,
    userId: string,
    orderBookKey: OrderBookKey,
    qtyToAdd: number,
  ) => { 
    console.log("price ", price)
    
    // if not created assigning default values
    if (!this.USERORDERBOOK[orderBookKey][type][price]) {
      this.USERORDERBOOK[orderBookKey][type][price] = {
        createdAt: Date.now(),
        totalQuantity: 0,
        users: []
      }
    }
    
    // fetching the order and sorting the users 
    const order = this.USERORDERBOOK[orderBookKey][type][price]!;
    order.users.push({ id: userId, createdAt: Date.now(), qty: qtyToAdd, price })
    const sortedUsers = order.users.sort((a, b) => a.createdAt - b.createdAt);
    
    // apending all latest details to this one
    this.USERORDERBOOK[orderBookKey][type][price] = {
      ...order,
      createdAt: Date.now(),
      totalQuantity: order.totalQuantity + qtyToAdd,
      users: sortedUsers
    }

    console.log("while adding to orderbook", this.USERORDERBOOK[orderBookKey][type][price])
  }

  checkAvailablePriceInOrderBook =(
    price: number,
    balanceKey: OrderBookKey,
    type: "asks" | "bids",
  ) => {
    // const data = this.ORDERBOOK[balanceKey][type];
    const data = this.USERORDERBOOK[balanceKey][type];
    // let key: number = 0

    // const keys = Object.keys(data);

    let keys;
    
    if (type === "asks") {
      // by default sorting from small to big numbers
      keys = Object.entries(data)
    } else {
      // for bids we need the biggest number on the top, so thats why sorting it
      keys = Object.entries(data).sort((a, b) => Number(b[0]) - Number(a[0]));
    }

    // these are the users from which we are deducting stocks (quantity)
    for (const [idx, [key, value]] of Object.entries(keys)) {
      /**
       * here 200 is the keyPrice and keyvalue is that array
       * 200: [{
       *    totalQuantity: number,
       *    userId: string
       * }]
       */
      
      const keyPrice = Number(key);
      
      // in the array there are many qty of different users to adding thosee
      if (type === "asks") {
        // finding the best buying price for the buyers for that we need LESS or EQUAL price (compare to the user)
        if (keyPrice <= price) {
          return { orderBookKey: keyPrice, keyPrice, qty: value.totalQuantity };
        }
      }
      
      if (type === "bids") {
        // finding best selling price for the sellers for that we need MORE or EQUAL price (compare to the user)
        if (keyPrice >= price) {
          return { orderBookKey: keyPrice, keyPrice, qty: value.totalQuantity };
        }
      }
      
    }

    
    // if (type === "asks") {
    //   if (keys
    //         .find((data) => Number(data)! < price)) {

    //     key = Number(keys.find((data) => Number(data)! < price))!

    //     return { orderBookKey: key, keyPrice: key, qty: data[key]!.totalQuantity };
    //   }
    // }

    // if (type === "bids") {
    //   if (
    //     keys
    //       .sort((a, b) => Number(b) - Number(a) ? 1 : -1).
    //       find((data) => Number(data)! > price)
    //   ) {
    //     key = Number(keys
    //       .sort((a, b) => Number(b) - Number(a)).
    //       find((data) => Number(data)! > price))!

          
    //       return { orderBookKey: key, keyPrice: key, qty: data[key]!.totalQuantity };
    //     }
    // }

    // if (keys.find((key) => price === Number(key))) {
    //   key = Number(keys.find((key) => price === Number(key)))!;

      
    //   return { orderBookKey: key, keyPrice: key, qty: data[key]!.totalQuantity };
    // }

    return null;
  }


  deductQtyAndBalanceOfInvolvedUsers = (users: UserInOrderBook[], availableQty: number, side: orderSide, finalPrice: number) => {    
    let decreasingQty = availableQty; // let say this 10
    
    const updatedUsers: UserInOrderBook[] = []

    // deducting quantity of the users involved in the swap
    for (const val of users) {
      if (decreasingQty - val.qty >= 0 ) { // here it will be 10 - (4) imaginary = 6 (means this user's all qty gone)
        updatedUsers.push({
          ...val,
          qty: 0
        })
        
        decreasingQty -= val.qty // decrasing the value for the next loop

        // handling user balances
        this.deductTotalBalalnceOfUser(
          val.id,
          side,
          finalPrice,
          val.qty,
          false
        );
        this.resetLockBalalnceOfUser(val.id, side, false);
      } else {
        const leftQty = Math.abs(decreasingQty - val.qty);

        updatedUsers.push({
          ...val,
          qty: leftQty
        })
        
        // handling user balances
        this.deductTotalBalalnceOfUser(
          val.id,
          side,
          finalPrice,
          decreasingQty,
          false
        );
        this.resetLockBalalnceOfUser(val.id, side, false);
      }
    }

    return updatedUsers;
  } 

  updateInvolvedUsersQtyInOrderBook = (users: UserInOrderBook[], side: orderSide, orderBookKey: number) => {
    const keySide = side === "BUY" ? "asks" : "bids";

    // getting the latest state
    const orderBook = this.USERORDERBOOK["AXIS"][keySide][orderBookKey]!;

    // deleting this one
    delete this.USERORDERBOOK["AXIS"][keySide][orderBookKey];

    // updating the users with the latest one
    const updatedUsers = orderBook.users.concat(users);

    // updating the order book
    this.USERORDERBOOK["AXIS"][keySide][orderBookKey] = {
      ...this.USERORDERBOOK["AXIS"][keySide][orderBookKey]!,
      users: updatedUsers
    }
  }

  getCustomOrder = (userId: string, price: number, side: orderSide) => {
    const orders = this.getOrders(userId);
    const order = orders.find((ord) => ord.price === price && ord.side !== side);
    
    return order;
  }

  creatingFillsForSwap = (updatedUsers: UserInOrderBook[], userId: string, orderId: string) => {
    const order = this.getOrder(orderId, userId)!;
        
    for (const val of updatedUsers) {
      const makerOrder = this.getCustomOrder(val.id, order.price, order.side)

      console.log("makerOrder", makerOrder)
      
      if (!makerOrder) continue;

      this.FILLS.push({
        id: crypto.randomUUID(),
        askedQty: order.qty,
        asset: "AXIS",
        createdAt: new Date(),
        filledQty: order.filledQty,
        makerId: val.id,
        makerOrderId: makerOrder.id,
        price: order.price,
        side: order.side,
        takerId: userId,
        takerOrderId: orderId,
        type: "TAKER"
      });
    }    
  }

  updateOrder = (userId: string, orderId: string, updatedOrderData: Partial<Order>) => {
    const order = this.getOrder(orderId, userId);
    if (!order) return;

    const updatedOrder = {
      ...order,
      ...updatedOrderData
    }

    this.deleteOrder(userId, order.id);

    this.createOrder(updatedOrder)
    this.pushOrderAndFillToQueue(updatedOrder, [], []);
  }


  /**
   * 
   * @param side => (asks | bids)
   * @param orderBookKey => price on the which the user get matched
   * @param userQty => quantity asked by the user
   * @param availableQty => available qty in the key
   * @param userId => present user
   * @param finalPrice => price paid by the user
   * @param type => (MARKET | LIMIT)
   * @param users => the user of which qty we are eating
   * @param oldOrderId => is it the same order (looping on it)
   * @returns 
   */
  completeOrder = (
    side: orderSide, 
    orderBookKey: number, 
    userQty: number, 
    availableQty: number, 
    userId: string, 
    finalPrice: number, 
    type: orderType,
    users: UserInOrderBook[],
    orderId: string,
    way: "MANUAL" | "EXCHANGE"
  ) => {
    // const order =
    //   this.ORDERBOOK["AXIS"][side === "BUY" ? "asks" : "bids"][orderBookKey];
    const order =
      this.USERORDERBOOK["AXIS"][side === "BUY" ? "asks" : "bids"][orderBookKey]!;
      
    // if the same order get repeats for the user
    const existingOrder = this.getOrder(orderId, userId);
      
    if (!existingOrder) {
      const order: Order = {
        id: orderId,
        userId,
        type,
        status: userQty === availableQty ? "FILLED" : "PARTIAL_FILLED",
        filledQty: availableQty,
        qty: userQty,
        price: finalPrice,
        market: "AXIS",
        side,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      
      this.createOrder(order);
    } else {
      this.updateOrder(userId, orderId, {
        updatedAt: new Date(),
        filledQty: availableQty,
        qty: userQty,
        status: userQty === availableQty ? "FILLED" : "PARTIAL_FILLED"
      })
    }

    
    const updatedUsers = this.deductQtyAndBalanceOfInvolvedUsers(users, availableQty, side, finalPrice);
    
    console.log("users in the swap", users);
    console.log("updated users", updatedUsers)

    // updating the users in the order book
    this.updateInvolvedUsersQtyInOrderBook(updatedUsers, side, orderBookKey);
    
    this.creatingFillsForSwap(updatedUsers, userId, orderId);

    this.USERORDERBOOK.AXIS[side === "BUY" ? "asks" : "bids"][orderBookKey] = {
      ...order,
      totalQuantity: order.totalQuantity - availableQty
    };

    const reFetchedOrder = 
      this.USERORDERBOOK["AXIS"][side === "BUY" ? "asks" : "bids"][orderBookKey]!
    
    if (reFetchedOrder.totalQuantity === 0) {
      delete this.USERORDERBOOK["AXIS"][side === "BUY" ? "asks" : "bids"][orderBookKey]
    }
    
    this.USERORDERBOOK["AXIS"].lastTradedPrice = orderBookKey;

    
    if (market === "PERPS" || way === "EXCHANGE") {
      // for current user
      this.handlePosistionCreationAndCompensation(
        userId, 
        orderBookKey, 
        availableQty, 
        side, 
        type, 
        true, 
        orderId
      )
        
      // for other involved users
      for (const val of users) {
        this.handlePosistionCreationAndCompensation(
          val.id, 
          orderBookKey, 
          availableQty, 
          side, 
          type, 
          false, 
          orderId
        )
      }
    }

    const fills = this.getFills(userId, orderId);
    const toSendOrder = this.getOrder(orderId, userId)!;
    const toSendPositions = this.getAllPositions(orderId)!;
    
    this.pushOrderAndFillToQueue(toSendOrder, fills, toSendPositions)

    
    // handle balances on the current user
    // got used for SPOT (only)
    this.deductTotalBalalnceOfUser(
      userId,
      side,
      finalPrice,
      availableQty,
      true
    );
    this.resetLockBalalnceOfUser(userId, side, true);
    
    return { 
      status: userQty === availableQty ? "FILLED" : "PARTIAL_FILLED", 
      orderId, 
      fills,
      filledQty: availableQty,
      averagePrice: finalPrice
    };
  }

  deletePosition = (userId: string) => {
    const position = this.getAllPositions().find((pos) => pos.userId === userId);
    if (!position) return;

    this.POSITIONS = this.POSITIONS.filter((pos) => pos.userId !== userId);
    delete this.POSITIONS_MAPS[position.type][position.liquidationPrice]
  }

  handlePosistionCreationAndCompensation = (userId: string, orderBookKey: number, availableQty: number, side: orderSide, type: orderType, presentUser: boolean, orderId: string) => {
    const position = this.getPosition(userId);
    const usersPriceIncludingLeverage = this.calculateFinalPriceWithLeverage(userId, orderBookKey, availableQty);
    const { leverage, lockedPrice, priceAskedByUser, userActualBalance } = usersPriceIncludingLeverage;

    const averagePrice = this.calculateAveragePrice(userId, type);
    const margin = priceAskedByUser / leverage;
    let liquidationPrice = 0; 
    
    if (presentUser) {
      if (side === "BUY") {
        liquidationPrice = averagePrice * LIQUIDATION_PERCENTAGE;
      } else {
        liquidationPrice = averagePrice + (averagePrice - averagePrice * LIQUIDATION_PERCENTAGE);
      }
    } else {
      if (side === "BUY") {
        liquidationPrice = averagePrice + (averagePrice - averagePrice * LIQUIDATION_PERCENTAGE);
      } else {
        liquidationPrice = averagePrice * LIQUIDATION_PERCENTAGE;
      }
    }

    let currentType: postionType;
    
    if (presentUser) {
      currentType = side === "BUY" ? "LONG" : "SHORT"
    } else {
      currentType = side === "BUY" ? "SHORT" : "LONG"
    }
    
    if (!position) {
      // create position
      this.createPosition({
        averagePrice,
        liquidationPrice,
        margin,
        market: "AXIS",
        qty: availableQty,
        type: currentType,
        userId,
        orderId,
        pnl: 0,
        isProfit: false
      })
    } else {
      
      if (position.type === currentType) {
        this.deletePosition(userId);
        this.createPosition({
          averagePrice,
          liquidationPrice,
          margin,
          market: "AXIS",
          qty: position.qty + availableQty,
          type: position.type,
          userId,
          orderId,
          pnl: position.pnl,
          isProfit: false
        })  
      } else {
        // if user already had 4 long and done a 4 short then delete the position
        
        if (position.qty === availableQty) {
          this.deletePosition(userId);
        } else if (position.qty > availableQty) {
          this.deletePosition(userId);
          this.createPosition({
            averagePrice,
            liquidationPrice,
            margin,
            market: "AXIS",
            qty: position.qty - availableQty,
            type: position.type,
            userId,
            orderId,
            pnl: position.pnl,
            isProfit: false
          })
        } else {
          this.deletePosition(userId);
          this.createPosition({
            averagePrice,
            liquidationPrice,
            margin,
            market: "AXIS",
            qty: availableQty - position.qty,
            type: currentType,
            userId,
            orderId,
            pnl: 0,
            isProfit: false
          })
        }
      }
    }
  }

  beforeOrder = (parsedResponse: RedisQueueData): BeforeOrderResponse => {
    if (parsedResponse.type !== "create_order") return {
      clientId: parsedResponse.clientId,
      ok: false,
      type: "ERROR",
    }
      
    const { side, symbol, type, userId, price, qty, 
      // market 
    } = parsedResponse.data;

    if (type === "LIMIT") {
      // for limit we need both price and qty (conceptual)
      if (price === undefined || qty === undefined) {
        return {
          clientId: parsedResponse.clientId,
          ok: false,
          error: "Price and quantity both should be defined.",
          type: "ERROR",
        };
      }
    } else if (type === "MARKET") {
      // for market any one value is able to find the other one thats why one value should be defined
      if (price === undefined && qty === undefined) {
        return {
          clientId: parsedResponse.clientId,
          ok: false,
          error: "Price and quantity both should be defined.",
          type: "ERROR",
        };
      }
    }
    
    // one time more just for making TS happy.
    if (price === undefined || qty === undefined) {
      return {
        clientId: parsedResponse.clientId,
        ok: false,
        error: "Price and quantity both should be defined.",
        type: "ERROR",
      };
    }


    // fn for checking does user have balance 
    const isUserHaveBalance = this.gettingAndLockingUserBalance(
      userId,
      price,
      qty,
      side,
    );

    if (!isUserHaveBalance) {
      return {
        clientId: parsedResponse.clientId,
        ok: false,
        error: "Insufficient balance.",
        type: "ERROR"
      };
    }

    // finding available price from the orderbook
    const availablePrice = engineStore.checkAvailablePriceInOrderBook(
      price,
      "AXIS",
      side === "BUY" ? "asks" : "bids",
    );


    // if price is not available and type is market, means the user want on the spot execution, so will cancel the order
    if (!availablePrice && type === "MARKET") {
      // reset lock
      this.resetLockBalalnceOfUser(userId, side, true)

      return {
        clientId: parsedResponse.clientId,
        ok: false,
        data: {
          message: "available price not found",
          data: undefined
        },
        type: "ERROR"
      }
    }
    
    // here the type will be LIMI, so we will add it in the orderBook
    if (!availablePrice) {
      this.addNewAsksOrBidsInOrderBook(
        side === "SELL" ? "asks" : "bids",
        price,
        userId,
        "AXIS",
        qty,
      );

      const order: Order = {
        id: parsedResponse.data.orderId,
        userId,
        status: "OPEN",
        market: "AXIS",
        side,
        type,
        price,
        qty,
        filledQty: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      
      this.createOrder(order)

      this.pushOrderAndFillToQueue(order, [], []);
      
      return {
        clientId: parsedResponse.clientId,
        ok: true,
        data: {
          message: "Order added in the order book",
          data: {
            status: "OPEN",
            filledQty: 0,
            averagePrice: null,
            fills: []
          },
        },
        type: "ORDER_IN_ORDERBOOK"
      };
    }

    // returning the avilable qty for the further processing
    return {
      clientId: parsedResponse.clientId,
      ok: true,
      data: {
        message: "available price found",
        data: availablePrice
      },
      type: "AVAILABLE_PRICE"
    }
  }

  getLastTradingPrice() {
    // return this.ORDERBOOK["AXIS"].lastTradedPrice
    return this.USERORDERBOOK["AXIS"].lastTradedPrice
  }

  getUserInvolvedInSwap = (orderBookKey: number, totalQuantity: number, side: orderSide) => {
    let startQty = 0;
    const users: UserInOrderBook[] = [];

    const orderBook = this.USERORDERBOOK["AXIS"][side === "BUY" ? "asks" : "bids"][orderBookKey]!;

    console.log("orderbook key", orderBookKey);
    console.log("totalQuantity", totalQuantity);
    console.log("orderBook", orderBook)
    
    
    console.log("users ", users);
    
    
    for (const val of orderBook.users) {
      if (startQty >= totalQuantity) break;
      startQty += val.qty
      users.push(val)
    }

    return users;
  }

  backupData = () => {
    fs.writeFileSync("./orderbook.json", JSON.stringify(this.USERORDERBOOK));      
    fs.writeFileSync("./balances.json", JSON.stringify(this.BALANCES));
  }

  readBackupData = () => {
    try {
      const USERORDERBOOK = JSON.parse(fs.readFileSync("./orderbook.json").toString());
      const BALANCES = JSON.parse(fs.readFileSync("./balances.json").toString());
  
      return { USERORDERBOOK, BALANCES }
    } catch {
      return { 
        USERORDERBOOK: {
          AXIS: { bids: {}, asks: {}, lastTradedPrice: 0 },
          TATA: { bids: {}, asks: {}, lastTradedPrice: 0 },
        }, 
        BALANCES: {} 
      }
    }
  }
  
  testfn = () => {
    return null
  }
}

export const engineStore = EngineStore.getInstance();