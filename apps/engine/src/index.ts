import { redisManager } from "@repo/redis-client/redis-client";
import { ORDER_ENGINE_STREAM_CONFIGS } from "@repo/common/common";


for (;;) {
  const res = await redisManager.getFromStream(
    ORDER_ENGINE_STREAM_CONFIGS.group_name,
    ORDER_ENGINE_STREAM_CONFIGS.consumer_grp,
    ORDER_ENGINE_STREAM_CONFIGS.stream,
  );
  
  if (res) {    
    // TODO: check if we need to add loop in this (maybe not)
    console.log("res.messages", res.messages)
    
    for (const message of res.messages) {
      const parsedResponse = JSON.parse(message.message.data ?? "{}")
      // mostly here we need to add types in this
      // TODO: add types here and handle the shitss
      console.log("parsedResponse ", parsedResponse);



      await redisManager.acknowledgeMent(
        ORDER_ENGINE_STREAM_CONFIGS.stream, 
        ORDER_ENGINE_STREAM_CONFIGS.group_name, 
        message.id
      )
      
      // here push in the responseQueue inside the message
      console.log(parsedResponse.responseStream)
      await redisManager.addToStream(parsedResponse.responseStream, {
        ok: true,
        correlationId: parsedResponse.correlationId,
      });
    }
  }
}