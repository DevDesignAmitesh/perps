import { redisManager } from "@repo/redis-client/redis-client";
import { ORDER_ENGINE_STREAM_CONFIGS } from "@repo/common/common";
import { engineRequestHandler } from "./lib";


for (;;) {
  const res = await redisManager.getFromStream(
    ORDER_ENGINE_STREAM_CONFIGS.group_name,
    ORDER_ENGINE_STREAM_CONFIGS.consumer_grp,
    ORDER_ENGINE_STREAM_CONFIGS.stream,
  );
  
  if (!res) continue;    
  
  console.log("res.messages", res.messages)
  
  const parsedResponse = JSON.parse(res.messages[0]!.message.data ?? "{}")
  // mostly here we need to add types in this
  // TODO: add types here and handle the shitss
  console.log("parsedResponse ", parsedResponse);

  const engineResponse = engineRequestHandler(parsedResponse);
  
  await redisManager.acknowledgeMent(
    ORDER_ENGINE_STREAM_CONFIGS.stream, 
    ORDER_ENGINE_STREAM_CONFIGS.group_name, 
    res.messages[0]!.id
  )
  
  // here push in the responseQueue inside the message
  console.log(parsedResponse.responseStream)
  await redisManager.addToStream(parsedResponse.responseStream, engineResponse);
}