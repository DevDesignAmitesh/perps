import { ORDER_ENGINE_STREAM_CONFIGS, HTTP_BACKEND_STREAM_CONFIGS } from "@repo/common/common";
import { redisManager } from "."

for (;;) {
  const res = await redisManager.getFromStream(
    ORDER_ENGINE_STREAM_CONFIGS.group_name,
    ORDER_ENGINE_STREAM_CONFIGS.consumer_grp,
    ORDER_ENGINE_STREAM_CONFIGS.stream,
  );
  
  if (res) {    
    for (const message of res.messages) {
      const parsedResponse = JSON.parse(message.message.data ?? "{}")
      // mostly here we need to add types in this
      console.log("parsedResponse ", parsedResponse);

      // TODO: one ack here also that we picekd the messafe 
      console.log("her")
      await redisManager.acknowledgeMent(
        ORDER_ENGINE_STREAM_CONFIGS.stream, 
        ORDER_ENGINE_STREAM_CONFIGS.group_name, 
        message.id
      )
      
      // here push in the responseQueue inside the message
      console.log(parsedResponse.responseStream)
      await redisManager.addToStream(parsedResponse.responseStream, parsedResponse);
    }
  }
}