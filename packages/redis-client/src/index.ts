import { createClient, type RedisClientType } from "redis";
import { GROUPS, type MessageType } from "@repo/common/common";

class RedisManager {
  private static instance: RedisManager;
  private publisher: RedisClientType;
  private subscriber: RedisClientType;
  private client: RedisClientType;
  
  constructor() {
    this.publisher = createClient();
    this.subscriber = createClient();
    this.client = createClient();
  }

  static getInstance = async (): Promise<RedisManager> => {
    if (!RedisManager.instance) {
      const manager = new RedisManager();
      await manager.init();
      await manager.createGroups();
      RedisManager.instance = manager;
    };

    return RedisManager.instance;
  };

  private initClients = async () => {
    await Promise.all([
      this.publisher.connect(),
      this.subscriber.connect(),
      this.client.connect(),
    ]);
  };

  private createGroups = async () => {
    for (const { consumer_grp, group_name, stream } of GROUPS) {
      try {
        await this.client.xGroupCreate(stream, group_name, '0', {
          MKSTREAM: true
        });
        console.log("group: ", group_name, "created");
      } catch {
        console.log("group: ", group_name, "already exists");
      }
    }
  }

  private init = async () => {
    await this.initClients();
  }
  
  addToStream = async (group_stream: string, data: any) => {
    await this.client.xAdd(
      group_stream, 
      "*", 
      { data: JSON.stringify(data) }
    )
  }

  getFromStream = async (group_name: string, group_consumer: string, group_stream: string) => {
    const res = await this.client.xReadGroup(
      group_name,
      group_consumer,
      {
        id: ">",
        key: group_stream,
      },
      {
        BLOCK: 0,
      }
    );

    if (!res) return;
    if (!Array.isArray(res)) return;

    return res[0] as MessageType;
  }

  acknowledgeMent = async (group_stream: string, group_name: string, particular_message_id: string) => {
    const res = await this.client.xAck(group_stream, group_name, particular_message_id);
    console.log("acknowledgeMent ", res);
  }

  waitForData = async (
    group_name: string, 
    group_consumer: string, 
    group_stream: string, 
    response_stream: string,
    data: any, 
  ) => {

    return new Promise<MessageType>(async (res, rej) => {            
      const dataToSend = {
        ...data,
        responseStream: group_stream,
      }

      console.log("response_stream before adding", group_stream);
      
      await this.addToStream(response_stream, dataToSend);
      
      const response = await this.getFromStream(group_name, group_consumer, group_stream);

      if (response) res(response)
    });
  }
}

export const redisManager = await RedisManager.getInstance();